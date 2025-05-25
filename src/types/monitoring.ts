export enum MonitoringEvent {
  STEP_END = "STEP_END",
  STEP_ERROR = "STEP_ERROR",
}

export interface PipelineEvent {
  type: MonitoringEvent;
  timestamp: number;
  duration: number;
  step: string;
  data?: any;
  context?: {
    pipelineId: string;
    executionId: string;
    attempt: number;
  };
}

export interface PipelineLog {
  message: string;
  timestamp: number;
  context: {
    pipelineId: string;
    stepName: string;
    executionId: string;
  };
  metadata: Record<string, any>;
}
