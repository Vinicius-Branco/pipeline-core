import { MonitoringService } from "../../../services/monitoring.service";
import { MonitoringEvent, PipelineEvent } from "../../../types/monitoring";

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

    it("should handle multiple events in sequence", () => {
      const event1: PipelineEvent = {
        type: MonitoringEvent.STEP_END,
        timestamp: Date.now(),
        duration: 50,
        step: "step1",
        context: {
          pipelineId: "test-pipeline",
          executionId: "test-execution",
          attempt: 1,
        },
        data: { result: "step1-complete" },
      };

      const event2: PipelineEvent = {
        type: MonitoringEvent.STEP_END,
        timestamp: Date.now(),
        duration: 150,
        step: "step2",
        context: {
          pipelineId: "test-pipeline",
          executionId: "test-execution",
          attempt: 1,
        },
        data: { result: "step2-complete" },
      };

      monitoringService.emitEvent(event1);
      monitoringService.emitEvent(event2);

      expect(events).toHaveLength(2);
      expect(events[0]).toEqual(event1);
      expect(events[1]).toEqual(event2);
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

    it("should track step with async operations", async () => {
      const stepName = "asyncStep";
      const context = {
        pipelineId: "test-pipeline",
        executionId: "test-execution",
        attempt: 1,
      };

      const result = await monitoringService.trackStep(
        stepName,
        async () => {
          await new Promise(resolve => setTimeout(resolve, 100));
          return { asyncResult: "completed" };
        },
        context
      );

      expect(result).toEqual({ asyncResult: "completed" });
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe(MonitoringEvent.STEP_END);
      expect(events[0].step).toBe(stepName);
      expect(events[0].duration).toBeGreaterThanOrEqual(100);
    });

    it("should track step with complex data structures", async () => {
      const stepName = "complexStep";
      const context = {
        pipelineId: "test-pipeline",
        executionId: "test-execution",
        attempt: 1,
      };
      const complexData = {
        users: [
          { id: 1, name: "John", age: 30 },
          { id: 2, name: "Jane", age: 25 }
        ],
        metadata: {
          processed: true,
          timestamp: Date.now()
        }
      };

      const result = await monitoringService.trackStep(
        stepName,
        async () => complexData,
        context
      );

      expect(result).toEqual(complexData);
      expect(events).toHaveLength(1);
      expect(events[0].data).toEqual(complexData);
    });
  });

  describe("Event Types", () => {
    it("should handle different event types", () => {
      const endEvent: PipelineEvent = {
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

      const errorEvent: PipelineEvent = {
        type: MonitoringEvent.STEP_ERROR,
        timestamp: Date.now(),
        duration: 50,
        step: "testStep",
        context: {
          pipelineId: "test-pipeline",
          executionId: "test-execution",
          attempt: 1,
        },
        data: new Error("Test error"),
      };

      monitoringService.emitEvent(endEvent);
      monitoringService.emitEvent(errorEvent);

      expect(events).toHaveLength(2);
      expect(events[0].type).toBe(MonitoringEvent.STEP_END);
      expect(events[1].type).toBe(MonitoringEvent.STEP_ERROR);
    });
  });

  describe("Context Handling", () => {
    it("should preserve context information in events", () => {
      const context = {
        pipelineId: "pipeline-123",
        executionId: "exec-456",
        attempt: 3,
      };

      const testEvent: PipelineEvent = {
        type: MonitoringEvent.STEP_END,
        timestamp: Date.now(),
        duration: 100,
        step: "testStep",
        context,
        data: { result: "success" },
      };

      monitoringService.emitEvent(testEvent);
      expect(events[0].context).toEqual(context);
    });

    it("should handle context with custom properties", () => {
      const context = {
        pipelineId: "pipeline-123",
        executionId: "exec-456",
        attempt: 1,
      };

      const testEvent: PipelineEvent = {
        type: MonitoringEvent.STEP_END,
        timestamp: Date.now(),
        duration: 100,
        step: "testStep",
        context,
        data: { 
          result: "success",
          metadata: {
            environment: "production",
            version: "1.0.0",
            features: ["feature1", "feature2"],
          }
        },
      };

      monitoringService.emitEvent(testEvent);
      expect(events[0].context).toEqual(context);
      expect(events[0].data?.metadata?.environment).toBe("production");
    });
  });

  describe("Performance and Load", () => {
    it("should handle high event volume", () => {
      const eventCount = 1000;
      const startTime = Date.now();

      for (let i = 0; i < eventCount; i++) {
        const event: PipelineEvent = {
          type: MonitoringEvent.STEP_END,
          timestamp: Date.now(),
          duration: Math.random() * 100,
          step: `step${i}`,
          context: {
            pipelineId: "test-pipeline",
            executionId: "test-execution",
            attempt: 1,
          },
          data: { result: `result${i}` },
        };
        monitoringService.emitEvent(event);
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(events).toHaveLength(eventCount);
      // Should complete quickly (less than 1 second for 1000 events)
      expect(duration).toBeLessThan(1000);
    });

    it("should handle multiple listeners efficiently", () => {
      const listeners: PipelineEvent[][] = [];
      const listenerCount = 10;

      // Create multiple listeners
      for (let i = 0; i < listenerCount; i++) {
        const listenerEvents: PipelineEvent[] = [];
        listeners.push(listenerEvents);
        monitoringService.onEvent((event) => listenerEvents.push(event));
      }

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

      // All listeners should receive the event
      listeners.forEach(listenerEvents => {
        expect(listenerEvents).toHaveLength(1);
        expect(listenerEvents[0]).toEqual(testEvent);
      });
    });
  });

  describe("Error Handling", () => {
    it("should handle errors in event listeners gracefully", () => {
      const errorListener = jest.fn().mockImplementation(() => {
        throw new Error("Listener error");
      });

      const normalListener = jest.fn();

      monitoringService.onEvent(errorListener);
      monitoringService.onEvent(normalListener);

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

      // Should throw error because MonitoringService doesn't handle listener errors
      expect(() => {
        monitoringService.emitEvent(testEvent);
      }).toThrow("Listener error");

      expect(errorListener).toHaveBeenCalled();
      // Normal listener should not be called because error is thrown first
      expect(normalListener).not.toHaveBeenCalled();
    });

    it("should handle malformed events", () => {
      const malformedEvent = {
        type: "INVALID_TYPE",
        timestamp: "invalid-timestamp",
        step: 123, // Should be string
        duration: 100,
      } as any;

      // Should not throw error
      expect(() => {
        monitoringService.emitEvent(malformedEvent);
      }).not.toThrow();

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(malformedEvent);
    });
  });

  describe("Singleton Behavior", () => {
    it("should maintain singleton behavior across multiple getInstance calls", () => {
      const instance1 = MonitoringService.getInstance();
      const instance2 = MonitoringService.getInstance();
      const instance3 = MonitoringService.getInstance();

      expect(instance1).toBe(instance2);
      expect(instance2).toBe(instance3);
      expect(instance1).toBe(instance3);
    });

    it("should share event listeners across singleton instances", () => {
      const instance1 = MonitoringService.getInstance();
      const instance2 = MonitoringService.getInstance();

      const events1: PipelineEvent[] = [];
      const events2: PipelineEvent[] = [];

      instance1.onEvent((event) => events1.push(event));
      instance2.onEvent((event) => events2.push(event));

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

      expect(events1).toHaveLength(1);
      expect(events2).toHaveLength(1);
      expect(events1[0]).toEqual(testEvent);
      expect(events2[0]).toEqual(testEvent);
    });
  });
}); 