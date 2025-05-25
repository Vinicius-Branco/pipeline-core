export interface PipelineStep<TData = any> {
  name: string;
  execute(data: TData): Promise<TData>;
}

export interface RetryStrategy {
  maxRetries: number;
  backoffMs: number;
}

export interface StepOptions {
  workerTimeout?: number;
  maxConcurrentWorkers?: number;
  retryStrategy?: RetryStrategy;
}

export type StepHandler<TData = any> =
  | string
  | ((data: TData) => Promise<TData>);

export interface StepConfig<TStep extends string> {
  name: TStep;
  handler: StepHandler;
  errorHandlers?: StepErrorHandler<TStep>;
  options?: StepOptions;
}

export interface PipelineConfig<TStep extends string> {
  steps: StepConfig<TStep>[];
  options?: StepOptions;
}

export interface PipelineEvent<TStep extends string, TData = any> {
  data: TData;
  currentStep: TStep;
}

export interface PipelineOptions {
  workerTimeout?: number;
  maxConcurrentWorkers?: number;
  retryStrategy?: RetryStrategy;
  transpileAlways?: boolean;
}

export enum ErrorActionType {
  CONTINUE = "CONTINUE",
  STOP = "STOP",
  RETRY = "RETRY",
  CUSTOM = "CUSTOM",
}

export interface ErrorAction {
  type: ErrorActionType;
  nextStep?: string;
  maxRetries?: number;
  handler?: (error: Error, context: ErrorContext) => Promise<ErrorAction>;
}

export interface ErrorContext<TStep extends string = string, TData = any> {
  step: TStep;
  data: TData;
  error: Error;
  retryCount: number;
  pipelineState: {
    currentStep: TStep;
    steps: TStep[];
  };
}

export interface StepErrorHandler<TStep extends string> {
  onError: (error: Error, context: ErrorContext<TStep>) => Promise<ErrorAction>;
  onRetry?: (context: ErrorContext<TStep>) => Promise<void>;
  onStop?: (context: ErrorContext<TStep>) => Promise<void>;
  onContinue?: (context: ErrorContext<TStep>) => Promise<void>;
}

// Constants for event types
export const EVENT_TYPES = {
  ERROR: "ERROR",
  RETRY: "RETRY",
  STOP: "STOP",
} as const;

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

// Types for error events
export interface PipelineErrorEvent<TStep extends string, TData = any> {
  type: typeof EVENT_TYPES.ERROR;
  step: TStep;
  error: Error;
  data: TData;
  context: ErrorContext<TStep, TData>;
}

export interface PipelineRetryEvent<TStep extends string, TData = any> {
  type: typeof EVENT_TYPES.RETRY;
  step: TStep;
  data: TData;
  context: ErrorContext<TStep, TData>;
}

export interface PipelineStopEvent<TStep extends string, TData = any> {
  type: typeof EVENT_TYPES.STOP;
  step: TStep;
  data: TData;
  context: ErrorContext<TStep, TData>;
}

export interface PipelineEventType<TStep extends string, TData = any> {
  type: string;
  step: TStep;
  data: TData;
  duration: number;
  timestamp: number;
  error?: Error;
  context: {
    step: TStep;
    data: TData;
    error?: Error;
    retryCount: number;
    pipelineState: {
      currentStep: TStep;
      steps: TStep[];
    };
  };
}
