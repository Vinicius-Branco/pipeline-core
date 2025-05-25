import { randomUUID } from "crypto";
import {
  MonitoringConfig,
  PipelineEvent,
  PipelineLog,
} from "../types/monitoring";

export class MonitoringService {
  private static instance: MonitoringService;
  private eventListeners: Array<(event: PipelineEvent) => void> = [];
  private logs: PipelineLog[] = [];
  private config: MonitoringConfig;

  private constructor(config: MonitoringConfig) {
    this.config = config;
  }

  public static getInstance(config: MonitoringConfig): MonitoringService {
    if (!MonitoringService.instance) {
      MonitoringService.instance = new MonitoringService(config);
    }
    return MonitoringService.instance;
  }

  public onEvent(listener: (event: PipelineEvent) => void): void {
    this.eventListeners.push(listener);
  }

  public emitEvent(event: PipelineEvent): void {
    this.eventListeners.forEach((listener) => listener(event));
  }

  public async trackStep<T>(
    stepName: string,
    handler: () => Promise<T>,
    context: { pipelineId: string; executionId: string; attempt: number }
  ): Promise<T> {
    try {
      const result = await handler();

      this.emitEvent({
        type: "STEP_END",
        timestamp: Date.now(),
        stepName,
        context,
      });

      return result;
    } catch (error: unknown) {
      this.emitEvent({
        type: "STEP_ERROR",
        timestamp: Date.now(),
        stepName,
        context,
        data: error,
      });

      throw error;
    }
  }

  public log(
    level: "debug" | "info" | "warn" | "error",
    message: string,
    context: any
  ): void {
    const logEntry: PipelineLog = {
      level,
      message,
      timestamp: Date.now(),
      context: {
        pipelineId: context.pipelineId || "unknown",
        stepName: context.stepName || "unknown",
        executionId: context.executionId || randomUUID(),
      },
      metadata: context,
    };

    this.logs.push(logEntry);

    if (this.config.logging?.destination === "console") {
      console[level](JSON.stringify(logEntry));
    }
  }

  public getLogs(): PipelineLog[] {
    return this.logs;
  }
}
