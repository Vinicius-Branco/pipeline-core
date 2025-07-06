import { MonitoringService } from "../../services/monitoring.service";
import { MonitoringEvent, PipelineEvent } from "../../types/monitoring";

describe("Monitoring Service Integration Tests", () => {
  let monitoringService: MonitoringService;
  let events: PipelineEvent[];

  beforeEach(() => {
    (MonitoringService as any).instance = undefined;
    monitoringService = MonitoringService.getInstance();
    events = [];
    monitoringService.onEvent((event) => events.push(event));
  });

  afterEach(() => {
    events = [];
  });

  describe("Event Handling", () => {
    it("should emit and receive events correctly", () => {
      const testEvent: PipelineEvent = {
        type: MonitoringEvent.STEP_END,
        timestamp: Date.now(),
        duration: 100,
        step: "testStep",
        context: {
          pipelineId: "test-pipeline",
          executionId: "test-execution",
          attempt: 1,
        },
        data: { result: "success" },
      };

      monitoringService.emitEvent(testEvent);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(testEvent);
    });

    it("should handle multiple event listeners", () => {
      const secondEvents: PipelineEvent[] = [];
      monitoringService.onEvent((event) => secondEvents.push(event));

      const testEvent: PipelineEvent = {
        type: MonitoringEvent.STEP_END,
        timestamp: Date.now(),
        duration: 100,
        step: "testStep",
        context: {
          pipelineId: "test-pipeline",
          executionId: "test-execution",
          attempt: 1,
        },
        data: { result: "success" },
      };

      monitoringService.emitEvent(testEvent);
      expect(events).toHaveLength(1);
      expect(secondEvents).toHaveLength(1);
      expect(events[0]).toEqual(testEvent);
      expect(secondEvents[0]).toEqual(testEvent);
    });
  });

  describe("Step Tracking", () => {
    it("should track successful step execution", async () => {
      const stepName = "testStep";
      const context = {
        pipelineId: "test-pipeline",
        executionId: "test-execution",
        attempt: 1,
      };
      const expectedResult = { result: "success" };

      const result = await monitoringService.trackStep(
        stepName,
        async () => expectedResult,
        context
      );

      expect(result).toEqual(expectedResult);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe(MonitoringEvent.STEP_END);
      expect(events[0].step).toBe(stepName);
      expect(events[0].context).toEqual(context);
      expect(events[0].data).toEqual(expectedResult);
      expect(events[0].duration).toBeGreaterThanOrEqual(0);
    });

    it("should track failed step execution", async () => {
      const stepName = "testStep";
      const context = {
        pipelineId: "test-pipeline",
        executionId: "test-execution",
        attempt: 1,
      };
      const error = new Error("Test error");

      await expect(
        monitoringService.trackStep(
          stepName,
          async () => {
            throw error;
          },
          context
        )
      ).rejects.toThrow("Test error");

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe(MonitoringEvent.STEP_ERROR);
      expect(events[0].step).toBe(stepName);
      expect(events[0].context).toEqual(context);
      expect(events[0].data).toBe(error);
      expect(events[0].duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Singleton Pattern", () => {
    it("should maintain singleton instance", () => {
      const instance1 = MonitoringService.getInstance();
      const instance2 = MonitoringService.getInstance();

      expect(instance1).toBe(instance2);
    });

    it("should share event listeners between instances", () => {
      const instance1 = MonitoringService.getInstance();
      const instance2 = MonitoringService.getInstance();
      const secondEvents: PipelineEvent[] = [];
      instance2.onEvent((event) => secondEvents.push(event));

      const testEvent: PipelineEvent = {
        type: MonitoringEvent.STEP_END,
        timestamp: Date.now(),
        duration: 100,
        step: "testStep",
        context: {
          pipelineId: "test-pipeline",
          executionId: "test-execution",
          attempt: 1,
        },
        data: { result: "success" },
      };

      instance1.emitEvent(testEvent);
      expect(events).toHaveLength(1);
      expect(secondEvents).toHaveLength(1);
    });
  });
});
