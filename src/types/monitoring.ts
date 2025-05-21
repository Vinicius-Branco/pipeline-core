export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Tracer {
  startSpan(name: string): Span;
}

export interface Span {
  setStatus(status: { code: number; message?: string }): void;
  end(): void;
}

export interface PipelineEvent {
  type:
    | "STEP_START"
    | "STEP_END"
    | "STEP_ERROR"
    | "PIPELINE_START"
    | "PIPELINE_END"
    | "RETRY_ATTEMPT"
    | "PERFORMANCE_METRIC";
  timestamp: number;
  stepName?: string;
  data?: any;
  metrics?: PipelineMetrics;
  context?: {
    pipelineId: string;
    executionId: string;
    attempt: number;
  };
}

export interface PipelineMetrics {
  stepDuration: number;
  totalDuration: number;
  memoryUsage: number;
  cpuUsage: number;
  successRate: number;
  errorRate: number;
  retryCount: number;
  stepsCompleted: number;
  stepsFailed: number;
  concurrentExecutions: number;
}

export interface PipelineLog {
  level: LogLevel;
  message: string;
  timestamp: number;
  context: {
    pipelineId: string;
    stepName: string;
    executionId: string;
  };
  metadata: Record<string, any>;
}

export interface MonitoringConfig {
  telemetry?: {
    enabled: boolean;
    tracer?: Tracer;
  };
  metrics?: {
    enabled: boolean;
    interval?: number;
  };
  logging?: {
    level: LogLevel;
    format: "json" | "text";
    destination: "file" | "console" | "elasticsearch";
  };
}
