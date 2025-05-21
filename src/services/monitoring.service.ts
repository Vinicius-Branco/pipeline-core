import { randomUUID } from "crypto";
import {
  MonitoringConfig,
  PipelineEvent,
  PipelineLog,
  PipelineMetrics,
  Tracer,
} from "../types/monitoring";

export class MonitoringService {
  private static instance: MonitoringService;
  private eventListeners: Array<(event: PipelineEvent) => void> = [];
  private metrics: Map<string, PipelineMetrics> = new Map();
  private logs: PipelineLog[] = [];
  private config: MonitoringConfig;
  private tracer: Tracer | null = null;

  private constructor(config: MonitoringConfig) {
    this.config = config;
    this.initializeTelemetry();
  }

  public static getInstance(config: MonitoringConfig): MonitoringService {
    if (!MonitoringService.instance) {
      MonitoringService.instance = new MonitoringService(config);
    }
    return MonitoringService.instance;
  }

  private initializeTelemetry() {
    if (this.config.telemetry?.enabled) {
      this.tracer = this.config.telemetry.tracer || null;
    }
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
    const startTime = Date.now();
    const span = this.tracer?.startSpan(`step.${stepName}`);

    try {
      const result = await handler();
      const duration = Date.now() - startTime;

      this.updateMetrics(stepName, {
        stepDuration: duration,
        successRate: 1,
        stepsCompleted: 1,
      });

      this.emitEvent({
        type: "STEP_END",
        timestamp: Date.now(),
        stepName,
        context,
        metrics: {
          stepDuration: duration,
          totalDuration: duration,
          memoryUsage: process.memoryUsage().heapUsed,
          cpuUsage: process.cpuUsage().user,
          successRate: 1,
          errorRate: 0,
          retryCount: 0,
          stepsCompleted: 1,
          stepsFailed: 0,
          concurrentExecutions: 1,
        },
      });

      span?.setStatus({ code: 1 }); // OK
      return result;
    } catch (error: unknown) {
      const duration = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      this.updateMetrics(stepName, {
        stepDuration: duration,
        errorRate: 1,
        stepsFailed: 1,
      });

      this.emitEvent({
        type: "STEP_ERROR",
        timestamp: Date.now(),
        stepName,
        context,
        data: error,
        metrics: {
          stepDuration: duration,
          totalDuration: duration,
          memoryUsage: process.memoryUsage().heapUsed,
          cpuUsage: process.cpuUsage().user,
          successRate: 0,
          errorRate: 1,
          retryCount: 0,
          stepsCompleted: 0,
          stepsFailed: 1,
          concurrentExecutions: 1,
        },
      });

      span?.setStatus({ code: 2, message: errorMessage }); // ERROR
      throw error;
    } finally {
      span?.end();
    }
  }

  private updateMetrics(
    stepName: string,
    newMetrics: Partial<PipelineMetrics>
  ): void {
    const currentMetrics = this.metrics.get(stepName) || {
      stepDuration: 0,
      totalDuration: 0,
      memoryUsage: 0,
      cpuUsage: 0,
      successRate: 0,
      errorRate: 0,
      retryCount: 0,
      stepsCompleted: 0,
      stepsFailed: 0,
      concurrentExecutions: 0,
    };

    this.metrics.set(stepName, {
      ...currentMetrics,
      ...newMetrics,
    });
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

  public getMetrics(): Map<string, PipelineMetrics> {
    return this.metrics;
  }

  public getLogs(): PipelineLog[] {
    return this.logs;
  }
}
