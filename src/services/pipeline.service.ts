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
  private workerService: WorkerService;

  constructor(config: PipelineConfig<TStep>) {
    this.config = config;
    this.monitoring = MonitoringService.getInstance();
    this.workerService = new WorkerService(config.options);
    this.setupEventPropagation();
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

  private getStepOptions(stepConfig: StepConfig<TStep>): StepOptions {
    // prioritize step's retryStrategy over global if it exists
    const globalRetry = this.config.options?.retryStrategy;
    const stepRetry = stepConfig.options?.retryStrategy;
    const retryStrategy = stepRetry !== undefined ? stepRetry : globalRetry;

    return {
      ...this.config.options,
      ...stepConfig.options,
      retryStrategy,
    };
  }

  private async executeHandler(
    handler: StepHandler<TData>,
    data: TData,
    stepOptions?: StepOptions
  ): Promise<TData> {
    // always use WorkerService to ensure consistent handling of timeouts and concurrency
    return this.workerService.runWorker(handler, data, stepOptions);
  }

  private async executeStep(
    step: TStep,
    data: TData,
    retryCount = 0
  ): Promise<TData> {
    // Add current step to visited steps
    this.visitedSteps.add(step);

    const stepConfig = this.config.steps.find((s) => s.name === step);
    if (!stepConfig) {
      throw new Error(`Step ${step} not found in steps`);
    }

    const stepOptions = this.getStepOptions(stepConfig);

    try {
      const result = await this.monitoring.trackStep(
        step,
        () => this.executeHandler(stepConfig.handler, data, stepOptions),
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
              (action.maxRetries || stepOptions.retryStrategy?.maxRetries || 3)
            ) {
              if (stepConfig.errorHandlers.onRetry) {
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
          (action.maxRetries || stepOptions.retryStrategy?.maxRetries || 3)
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
      // Process items in parallel with a concurrency limit
      const results: TData[] = [];
      const errors: Error[] = [];

      // Process items in batches to avoid memory issues
      const batchSize = this.config.options?.maxConcurrentWorkers || 2;

      for (let i = 0; i < input.length; i += batchSize) {
        const batch = input.slice(i, i + batchSize);
        const batchResults = await Promise.allSettled(
          batch.map((item) => this.processPipeline(item))
        );

        batchResults.forEach((result, index) => {
          if (result.status === "fulfilled") {
            results[i + index] = result.value;
          } else {
            errors.push(result.reason);
            // If the item failed, we'll add undefined to maintain the array structure
            results[i + index] = undefined as any;
          }
        });
      }

      // If there were any errors, throw them
      if (errors.length > 0) {
        throw new Error(
          `Failed to process ${errors.length} items: ${errors
            .map((e) => e.message)
            .join(", ")}`
        );
      }

      return results;
    }

    // Single item processing
    return this.processPipeline(input);
  }

  public onEvent(
    listener: (event: PipelineEventType<TStep, TData>) => void
  ): void {
    this.eventListeners.push(listener);
  }

  public async cleanup(): Promise<void> {
    await this.workerService.cleanup();
    this.eventListeners = [];
    this.visitedSteps.clear();
  }

  private notifyEventListeners(event: PipelineEventType<TStep, TData>): void {
    this.eventListeners.forEach((listener) => listener(event));
  }
}
