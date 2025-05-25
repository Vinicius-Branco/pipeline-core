import { PipelineEvent, MonitoringEvent } from "../types/monitoring";

export class MonitoringService {
  private static instance: MonitoringService;
  private eventListeners: Array<(event: PipelineEvent) => void> = [];

  public static getInstance(): MonitoringService {
    if (!MonitoringService.instance) {
      MonitoringService.instance = new MonitoringService();
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
    const startTime = Date.now();
    try {
      const result = await handler();
      const duration = Date.now() - startTime;

      this.emitEvent({
        type: MonitoringEvent.STEP_END,
        timestamp: Date.now(),
        duration,
        step: stepName,
        context,
        data: result,
      });

      return result;
    } catch (error: unknown) {
      const duration = Date.now() - startTime;
      this.emitEvent({
        type: MonitoringEvent.STEP_ERROR,
        timestamp: Date.now(),
        duration,
        step: stepName,
        context,
        data: error,
      });

      throw error;
    }
  }
}
