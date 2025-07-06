import {
  PipelineConfig,
  PipelineEvent,
  PipelineEventType,
  ErrorContext,
  ErrorAction,
  StepConfig,
  ErrorActionType,
  StepOptions,
  StepHandler,
  EVENT_TYPES,
  PipelineState,
  ShutdownOptions,
  ShutdownContext,
  SHUTDOWN_EVENT_TYPES,
  PipelineShutdownEvent,
  ExtendedPipelineEventType,
} from "../types";
import { MonitoringService } from "./monitoring.service";
import { WorkerService } from "./worker.service";

interface ActiveExecution {
  id: string;
  startTime: number;
  currentStep: string;
  data: any;
  promise: Promise<any>;
  resolve: (value: any) => void;
  reject: (error: Error) => void;
}

export class PipelineService<TStep extends string, TData = any> {
  private config: PipelineConfig<TStep>;
  private eventListeners: ((
    event: ExtendedPipelineEventType<TStep, TData>
  ) => void)[] = [];
  private visitedSteps: Set<string> = new Set();
  private monitoring: MonitoringService;
  private stepWorkers: Map<TStep, WorkerService> = new Map();
  private state: PipelineState = PipelineState.RUNNING;
  private activeExecutions: Map<string, ActiveExecution> = new Map();
  private shutdownPromise: Promise<void> | null = null;
  private shutdownResolve: (() => void) | null = null;

  constructor(config: PipelineConfig<TStep>) {
    this.config = config;
    this.monitoring = MonitoringService.getInstance();
    this.setupStepWorkers();
    this.setupEventPropagation();
  }

  private setupStepWorkers(): void {
    // Create an independent WorkerService for each step
    this.config.steps.forEach((step) => {
      const stepOptions = this.getStepOptions(step);
      this.stepWorkers.set(
        step.name,
        new WorkerService(stepOptions || this.config.options)
      );
    });
  }

  private setupEventPropagation(): void {
    this.monitoring.onEvent((event) => {
      const step = event.step as TStep;
      this.notifyEventListeners({
        type: event.type,
        step,
        duration: event.duration,
        timestamp: event.timestamp,
        data: event.data,
        context: {
          step,
          data: event.data as TData,
          retryCount: event.context?.attempt || 0,
          pipelineState: {
            currentStep: step,
            steps: this.config.steps.map((s) => s.name),
          },
        },
      });
    });
  }

  private getStepOptions(
    stepConfig: StepConfig<TStep>
  ): StepOptions | undefined {
    // Merge with global options if step-specific options exist
    if (!stepConfig.options) {
      return undefined;
    }

    return {
      ...this.config.options,
      ...stepConfig.options,
      retryStrategy:
        stepConfig.options.retryStrategy || this.config.options?.retryStrategy,
    };
  }

  private async executeHandler(
    handler: StepHandler<TData>,
    data: TData,
    stepName: TStep,
    stepOptions?: StepOptions
  ): Promise<TData> {
    const workerService = this.stepWorkers.get(stepName);
    if (!workerService) {
      throw new Error(`WorkerService not found for step ${stepName}`);
    }

    return workerService.runWorker(handler, data, stepOptions);
  }

  private async executeStep(
    step: TStep,
    data: TData,
    retryCount = 0
  ): Promise<TData> {
    this.visitedSteps.add(step);

    const stepConfig = this.config.steps.find((s) => s.name === step);
    if (!stepConfig) {
      throw new Error(`Step ${step} not found in steps`);
    }

    const stepOptions = this.getStepOptions(stepConfig);

    try {
      const result = await this.monitoring.trackStep(
        step,
        () => this.executeHandler(stepConfig.handler, data, step, stepOptions),
        { pipelineId: "pipeline", executionId: "1", attempt: retryCount + 1 }
      );
      return result;
    } catch (error) {
      if (stepConfig.errorHandlers?.onError) {
        const context: ErrorContext<TStep, TData> = {
          step,
          data,
          error: error as Error,
          retryCount,
          pipelineState: {
            currentStep: step,
            steps: this.config.steps.map((s) => s.name),
          },
        };

        const action = await stepConfig.errorHandlers.onError(
          error as Error,
          context
        );

        switch (action.type) {
          case ErrorActionType.RETRY:
            if (
              retryCount <
              (action.maxRetries || stepOptions?.retryStrategy?.maxRetries || 3)
            ) {
              if (stepConfig.errorHandlers.onRetry) {
                await stepConfig.errorHandlers.onRetry(context);
              }
              return this.executeStep(step, data, retryCount + 1);
            }
            break;
          case ErrorActionType.CONTINUE:
            if (action.nextStep) {
              if (this.visitedSteps.has(action.nextStep)) {
                throw new Error(
                  `Infinite loop detected: step ${action.nextStep} was already visited`
                );
              }
              if (stepConfig.errorHandlers.onContinue) {
                await stepConfig.errorHandlers.onContinue(context);
              }
              return this.executeStep(action.nextStep as TStep, data, 0);
            }
            break;
          case ErrorActionType.STOP:
            if (stepConfig.errorHandlers.onStop) {
              await stepConfig.errorHandlers.onStop(context);
            }
            throw error;
          case ErrorActionType.CUSTOM:
            if (action.handler) {
              const customAction = await action.handler(
                error as Error,
                context
              );
              return this.handleErrorAction(
                customAction,
                step,
                data,
                retryCount,
                context
              );
            }
            break;
        }
      }
      throw error;
    }
  }

  private async handleErrorAction(
    action: ErrorAction,
    step: TStep,
    data: TData,
    retryCount: number,
    context: ErrorContext<TStep, TData>
  ): Promise<TData> {
    const stepConfig = this.config.steps.find((s) => s.name === step);
    if (!stepConfig) {
      throw new Error(`Step ${step} not found in steps`);
    }

    const stepOptions = this.getStepOptions(stepConfig);

    switch (action.type) {
      case ErrorActionType.RETRY:
        if (
          retryCount <
          (action.maxRetries || stepOptions?.retryStrategy?.maxRetries || 3)
        ) {
          if (stepConfig.errorHandlers?.onRetry) {
            await stepConfig.errorHandlers.onRetry(context);
          }
          return this.executeStep(step, data, retryCount + 1);
        }
        break;
      case ErrorActionType.CONTINUE:
        if (action.nextStep) {
          // Check if next step was already visited to prevent loops
          if (this.visitedSteps.has(action.nextStep)) {
            throw new Error(
              `Infinite loop detected: step ${action.nextStep} was already visited`
            );
          }
          if (stepConfig.errorHandlers?.onContinue) {
            await stepConfig.errorHandlers.onContinue(context);
          }
          return this.executeStep(action.nextStep as TStep, data, 0);
        }
        break;
      case ErrorActionType.STOP:
        if (stepConfig.errorHandlers?.onStop) {
          await stepConfig.errorHandlers.onStop(context);
        }
        throw context.error;
    }
    throw context.error;
  }

  private async processPipeline(
    input: PipelineEvent<TStep, TData>
  ): Promise<TData> {
    // Clear visited steps history before each execution
    this.visitedSteps.clear();

    let currentData = input.data;
    let currentStep = input.currentStep;

    while (currentStep) {
      try {
        currentData = await this.executeStep(currentStep, currentData, 0);
        const currentIndex = this.config.steps.findIndex(
          (s) => s.name === currentStep
        );
        currentStep = this.config.steps[currentIndex + 1]?.name;
      } catch (error) {
        const event: PipelineEventType<TStep, TData> = {
          type: EVENT_TYPES.ERROR,
          step: currentStep,
          error: error as Error,
          data: currentData,
          duration: 0,
          timestamp: Date.now(),
          context: {
            step: currentStep,
            data: currentData,
            error: error as Error,
            retryCount: 0,
            pipelineState: {
              currentStep,
              steps: this.config.steps.map((s) => s.name),
            },
          },
        };
        this.notifyEventListeners(event);
        throw error;
      }
    }

    return currentData;
  }

  public async execute(
    input: PipelineEvent<TStep, TData> | PipelineEvent<TStep, TData>[]
  ): Promise<TData | TData[]> {
    if (this.state !== PipelineState.RUNNING) {
      throw new Error(
        `Pipeline is in ${this.state} state and cannot accept new executions`
      );
    }

    if (Array.isArray(input)) {
      // Process each item in parallel
      const results = await Promise.all(
        input.map(async (item) => {
          let currentData = item.data;
          let currentStep = item.currentStep;

          while (currentStep) {
            try {
              const stepConfig = this.config.steps.find(
                (s) => s.name === currentStep
              );
              if (!stepConfig) {
                throw new Error(`Step ${currentStep} not found in steps`);
              }

              // Execute the current step using its own WorkerService
              currentData = await this.executeHandler(
                stepConfig.handler,
                currentData,
                currentStep,
                this.getStepOptions(stepConfig)
              );

              // Determine the next step
              const currentIndex = this.config.steps.findIndex(
                (s) => s.name === currentStep
              );
              currentStep = this.config.steps[currentIndex + 1]?.name;
            } catch (error) {
              const event: PipelineEventType<TStep, TData> = {
                type: EVENT_TYPES.ERROR,
                step: currentStep,
                error: error as Error,
                data: currentData,
                duration: 0,
                timestamp: Date.now(),
                context: {
                  step: currentStep,
                  data: currentData,
                  error: error as Error,
                  retryCount: 0,
                  pipelineState: {
                    currentStep,
                    steps: this.config.steps.map((s) => s.name),
                  },
                },
              };
              this.notifyEventListeners(event);
              throw error;
            }
          }

          return currentData;
        })
      );

      return results;
    }

    return this.processPipeline(input);
  }

  public onEvent(
    listener: (event: ExtendedPipelineEventType<TStep, TData>) => void
  ): void {
    this.eventListeners.push(listener);
  }

  public getState(): PipelineState {
    return this.state;
  }

  public isShuttingDown(): boolean {
    return this.state === PipelineState.SHUTTING_DOWN;
  }

  public isShutdown(): boolean {
    return this.state === PipelineState.SHUTDOWN;
  }

  public getActiveExecutions(): number {
    return this.activeExecutions.size;
  }

  public getActiveExecutionsDetails(): ActiveExecution[] {
    return Array.from(this.activeExecutions.values());
  }

  public async shutdown(options: ShutdownOptions | number = {}): Promise<void> {
    if (this.state === PipelineState.SHUTDOWN) {
      return;
    }

    if (this.state === PipelineState.SHUTTING_DOWN) {
      if (this.shutdownPromise) {
        return this.shutdownPromise;
      }
      return;
    }

    // Normalize options
    const shutdownOptions: ShutdownOptions =
      typeof options === "number" ? { timeout: options } : options;

    const timeout = shutdownOptions.timeout || 30000;
    const startTime = Date.now();

    // Change state to shutting down
    this.state = PipelineState.SHUTTING_DOWN;

    // Create shutdown promise
    this.shutdownPromise = new Promise<void>((resolve) => {
      this.shutdownResolve = resolve;
    });

    // Create shutdown context
    const shutdownContext: ShutdownContext = {
      pipelineId: "pipeline",
      executionId: `shutdown-${Date.now()}`,
      startTime,
      timeout,
      activeExecutions: this.activeExecutions.size,
      activeWorkers: this.getTotalActiveWorkers(),
    };

    try {
      // Emit shutdown start event
      this.emitShutdownEvent(
        SHUTDOWN_EVENT_TYPES.SHUTDOWN_START,
        shutdownContext
      );

      // Call onShutdownStart callback
      if (shutdownOptions.onShutdownStart) {
        await shutdownOptions.onShutdownStart();
      }

      // Wait for active executions to complete
      await this.waitForActiveExecutions(timeout);

      // Shutdown all worker services
      await this.shutdownWorkerServices(timeout);

      // Change state to shutdown
      this.state = PipelineState.SHUTDOWN;

      // Emit shutdown complete event
      this.emitShutdownEvent(
        SHUTDOWN_EVENT_TYPES.SHUTDOWN_COMPLETE,
        shutdownContext
      );

      // Call onShutdownComplete callback
      if (shutdownOptions.onShutdownComplete) {
        await shutdownOptions.onShutdownComplete();
      }

      this.shutdownResolve?.();
    } catch (error) {
      // Emit shutdown error event
      this.emitShutdownEvent(
        SHUTDOWN_EVENT_TYPES.SHUTDOWN_ERROR,
        shutdownContext,
        error as Error
      );

      // If timeout reached, force shutdown
      if (shutdownOptions.onTimeout) {
        await shutdownOptions.onTimeout();
      }

      // Force cleanup
      await this.forceCleanup();
      this.state = PipelineState.SHUTDOWN;
      this.shutdownResolve?.();
    }
  }

  public async waitForCompletion(): Promise<void> {
    if (this.state === PipelineState.SHUTDOWN) {
      return;
    }

    return new Promise<void>((resolve) => {
      const checkInterval = setInterval(() => {
        if (
          this.activeExecutions.size === 0 &&
          this.getTotalActiveWorkers() === 0
        ) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);

      // Fallback timeout
      setTimeout(() => {
        clearInterval(checkInterval);
        resolve();
      }, 10000);
    });
  }

  private async waitForActiveExecutions(timeout: number): Promise<void> {
    if (this.activeExecutions.size === 0) {
      return;
    }

    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => {
        reject(
          new Error(`Timeout waiting for active executions after ${timeout}ms`)
        );
      }, timeout);
    });

    const waitPromise = new Promise<void>((resolve) => {
      const checkInterval = setInterval(() => {
        if (this.activeExecutions.size === 0) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
    });

    await Promise.race([waitPromise, timeoutPromise]);
  }

  private async shutdownWorkerServices(timeout: number): Promise<void> {
    const shutdownPromises = Array.from(this.stepWorkers.values()).map(
      (workerService) => workerService.shutdown(timeout)
    );

    await Promise.all(shutdownPromises);
  }

  private async forceCleanup(): Promise<void> {
    // Cancel all active executions
    for (const execution of this.activeExecutions.values()) {
      execution.reject(new Error("Pipeline shutdown forced"));
    }
    this.activeExecutions.clear();

    // Force shutdown all worker services
    for (const workerService of this.stepWorkers.values()) {
      await workerService.abortAllWorkers();
    }

    // Clean up resources
    await this.cleanup();
  }

  private getTotalActiveWorkers(): number {
    let total = 0;
    for (const workerService of this.stepWorkers.values()) {
      total += workerService.getActiveWorkersCount();
    }
    return total;
  }

  private emitShutdownEvent(
    type: string,
    context: ShutdownContext,
    error?: Error
  ): void {
    const event: PipelineShutdownEvent<TStep, TData> = {
      type: type as any,
      context,
      timestamp: Date.now(),
      error,
      message: error?.message,
    };

    this.notifyEventListeners(event);
  }

  public async cleanup(): Promise<void> {
    // Clean up all WorkerServices
    for (const workerService of this.stepWorkers.values()) {
      await workerService.cleanup();
    }
    this.stepWorkers.clear();
    this.eventListeners = [];
    this.visitedSteps.clear();
    this.activeExecutions.clear();
  }

  private notifyEventListeners(
    event: ExtendedPipelineEventType<TStep, TData>
  ): void {
    this.eventListeners.forEach((listener) => listener(event));
  }
}
