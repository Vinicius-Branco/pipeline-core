import { Worker } from "worker_threads";
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
} from "../types";

export class PipelineService<TStep extends string, TData = any> {
  private config: PipelineConfig<TStep>;
  private eventListeners: ((event: PipelineEventType<TStep, TData>) => void)[] =
    [];
  private visitedSteps: Set<string> = new Set();
  private readonly MAX_STEPS = 1000; // Maximum steps limit to prevent infinite loops

  constructor(config: PipelineConfig<TStep>) {
    this.config = config;
  }

  private getStepOptions(stepConfig: StepConfig<TStep>): StepOptions {
    return {
      ...this.config.options,
      ...stepConfig.options,
      retryStrategy: {
        ...this.config.options?.retryStrategy,
        ...stepConfig.options?.retryStrategy,
      },
    };
  }

  private async executeHandler(
    handler: StepHandler<TData>,
    data: TData
  ): Promise<TData> {
    if (typeof handler === "function") {
      return handler(data);
    }

    // If it's a string, assume it's a file path
    const worker = new Worker(handler);

    try {
      return await new Promise<TData>((resolve, reject) => {
        const messageHandler = (result: TData) => {
          cleanup();
          resolve(result);
        };

        const errorHandler = (error: Error) => {
          cleanup();
          reject(error);
        };

        const cleanup = () => {
          worker.removeListener("message", messageHandler);
          worker.removeListener("error", errorHandler);
          worker.terminate();
        };

        worker.on("message", messageHandler);
        worker.on("error", errorHandler);
        worker.postMessage(data);
      });
    } catch (error) {
      worker.terminate();
      throw error;
    }
  }

  private async executeStep(
    step: TStep,
    data: TData,
    retryCount = 0
  ): Promise<TData> {
    // Check if maximum steps limit is exceeded
    if (this.visitedSteps.size >= this.MAX_STEPS) {
      throw new Error(
        "Maximum steps limit exceeded. Possible infinite loop detected."
      );
    }

    // Add current step to visited steps
    this.visitedSteps.add(step);

    const stepConfig = this.config.steps.find((s) => s.name === step);
    if (!stepConfig) {
      throw new Error(`Step ${step} not found in steps`);
    }

    const stepOptions = this.getStepOptions(stepConfig);

    try {
      return await this.executeHandler(stepConfig.handler, data);
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
        this.notifyEventListeners({
          type: "ERROR",
          step: currentStep,
          error: error as Error,
          data: currentData,
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
        });
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
      const batchSize = this.config.options?.maxConcurrentWorkers || 10;

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

  private notifyEventListeners(event: PipelineEventType<TStep, TData>): void {
    this.eventListeners.forEach((listener) => listener(event));
  }
}
