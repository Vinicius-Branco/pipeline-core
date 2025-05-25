export type LogLevel = "debug" | "info" | "warn" | "error";

export interface PipelineEvent {
  type:
    | "STEP_START"
    | "STEP_END"
    | "STEP_ERROR"
    | "PIPELINE_START"
    | "PIPELINE_END"
    | "RETRY_ATTEMPT";
  timestamp: number;
  stepName?: string;
  data?: any;
  context?: {
    pipelineId: string;
    executionId: string;
    attempt: number;
  };
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
  logging?: {
    level: LogLevel;
    format: "json" | "text";
    destination: "file" | "console" | "elasticsearch";
  };
}
