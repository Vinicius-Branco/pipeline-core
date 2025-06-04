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
} from "../types";
import { MonitoringService } from "./monitoring.service";
import { WorkerService } from "./worker.service";

export class PipelineService<TStep extends string, TData = any> {
  private config: PipelineConfig<TStep>;
  private eventListeners: ((event: PipelineEventType<TStep, TData>) => void)[] =
    [];
  private visitedSteps: Set<string> = new Set();
  private monitoring: MonitoringService;
  private stepWorkers: Map<TStep, WorkerService> = new Map();

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

              // Executa o step atual usando seu próprio WorkerService
              currentData = await this.executeHandler(
                stepConfig.handler,
                currentData,
                currentStep,
                this.getStepOptions(stepConfig)
              );

              // Determina o próximo step
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
    listener: (event: PipelineEventType<TStep, TData>) => void
  ): void {
    this.eventListeners.push(listener);
  }

  public async cleanup(): Promise<void> {
    // Clean up all WorkerServices
    for (const workerService of this.stepWorkers.values()) {
      await workerService.cleanup();
    }
    this.stepWorkers.clear();
    this.eventListeners = [];
    this.visitedSteps.clear();
  }

  private notifyEventListeners(event: PipelineEventType<TStep, TData>): void {
    this.eventListeners.forEach((listener) => listener(event));
  }
}
