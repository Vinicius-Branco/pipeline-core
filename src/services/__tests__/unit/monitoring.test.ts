import { MonitoringService } from "../../monitoring.service";
import { MonitoringEvent } from "../../../types/monitoring";

describe("MonitoringService", () => {
  let monitoringService: MonitoringService;

  beforeEach(() => {
    (MonitoringService as any).instance = undefined;
    monitoringService = MonitoringService.getInstance();
  });

  describe("Singleton Pattern", () => {
    it("should return the same instance on multiple getInstance calls", () => {
      const instance1 = MonitoringService.getInstance();
      const instance2 = MonitoringService.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe("Event Listeners", () => {
    it("should add event listeners", () => {
      const listener = jest.fn();
      monitoringService.onEvent(listener);
      expect(listener).not.toHaveBeenCalled();
    });

    it("should call all registered listeners when emitting an event", () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();
      monitoringService.onEvent(listener1);
      monitoringService.onEvent(listener2);

      const event = {
        type: MonitoringEvent.STEP_END,
        timestamp: Date.now(),
        duration: 100,
        step: "test-step",
        context: { pipelineId: "123", executionId: "456", attempt: 1 },
      };

      monitoringService.emitEvent(event);

      expect(listener1).toHaveBeenCalledWith(event);
      expect(listener2).toHaveBeenCalledWith(event);
    });

    it("should call listener with exact event data when emitting", () => {
      const listener = jest.fn();
      monitoringService.onEvent(listener);

      const event = {
        type: MonitoringEvent.STEP_END,
        timestamp: 1234567890,
        duration: 100,
        step: "test-step",
        context: { pipelineId: "123", executionId: "456", attempt: 1 },
        data: "test-data"
      };

      monitoringService.emitEvent(event);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(event);
    });

    it("should call multiple listeners in registration order", () => {
      const callOrder: string[] = [];
      const listener1 = jest.fn(() => callOrder.push("listener1"));
      const listener2 = jest.fn(() => callOrder.push("listener2"));
      const listener3 = jest.fn(() => callOrder.push("listener3"));

      monitoringService.onEvent(listener1);
      monitoringService.onEvent(listener2);
      monitoringService.onEvent(listener3);

      const event = {
        type: MonitoringEvent.STEP_END,
        timestamp: Date.now(),
        duration: 100,
        step: "test-step",
        context: { pipelineId: "123", executionId: "456", attempt: 1 },
      };

      monitoringService.emitEvent(event);

      expect(callOrder).toEqual(["listener1", "listener2", "listener3"]);
      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
      expect(listener3).toHaveBeenCalledTimes(1);
    });
  });

  describe("Step Tracking", () => {
    const context = {
      pipelineId: "123",
      executionId: "456",
      attempt: 1,
    };

    it("should track successful step execution", async () => {
      const listener = jest.fn();
      monitoringService.onEvent(listener);

      const handler = jest.fn().mockResolvedValue("success");
      const result = await monitoringService.trackStep(
        "test-step",
        handler,
        context
      );

      expect(result).toBe("success");
      expect(handler).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MonitoringEvent.STEP_END,
          step: "test-step",
          context,
          duration: expect.any(Number),
          timestamp: expect.any(Number),
        })
      );
    });

    it("should track failed step execution", async () => {
      const listener = jest.fn();
      monitoringService.onEvent(listener);

      const error = new Error("test error");
      const handler = jest.fn().mockRejectedValue(error);

      await expect(
        monitoringService.trackStep("test-step", handler, context)
      ).rejects.toThrow("test error");

      expect(handler).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MonitoringEvent.STEP_ERROR,
          step: "test-step",
          context,
          duration: expect.any(Number),
          timestamp: expect.any(Number),
          data: error,
        })
      );
    });

    it("should calculate correct duration for step execution", async () => {
      const listener = jest.fn();
      monitoringService.onEvent(listener);

      const delay = (ms: number) =>
        new Promise((resolve) => setTimeout(resolve, ms));
      const handler = async () => {
        await delay(100);
        return "success";
      };

      await monitoringService.trackStep("test-step", handler, context);

      const event = listener.mock.calls[0][0];
      expect(event.duration).toBeGreaterThanOrEqual(95);
    });

    it("should calculate exact duration for successful step", async () => {
      const listener = jest.fn();
      monitoringService.onEvent(listener);

      const startTime = Date.now();
      const handler = jest.fn().mockResolvedValue("success");

      await monitoringService.trackStep("test-step", handler, context);
      const actualDuration = Date.now() - startTime;

      const event = listener.mock.calls[0][0];
      expect(event.duration).toBeGreaterThanOrEqual(0);
      expect(event.duration).toBeLessThanOrEqual(actualDuration + 10);
    });

    it("should calculate exact duration for failed step", async () => {
      const listener = jest.fn();
      monitoringService.onEvent(listener);

      const startTime = Date.now();
      const error = new Error("test error");
      const handler = jest.fn().mockRejectedValue(error);

      try {
        await monitoringService.trackStep("test-step", handler, context);
      } catch (e) {
        // Expected to throw
      }

      const actualDuration = Date.now() - startTime;
      const event = listener.mock.calls[0][0];
      expect(event.duration).toBeGreaterThanOrEqual(0);
      expect(event.duration).toBeLessThanOrEqual(actualDuration + 10);
    });

    it("should emit event with correct duration calculation for immediate success", async () => {
      const listener = jest.fn();
      monitoringService.onEvent(listener);

      const handler = jest.fn().mockResolvedValue("success");

      await monitoringService.trackStep("test-step", handler, context);

      const event = listener.mock.calls[0][0];
      expect(event.duration).toBeGreaterThanOrEqual(0); // Should be 0 or 1ms for immediate execution
      expect(event.duration).toBeLessThanOrEqual(5); // Allow small overhead for async processing
    });

    it("should emit event with correct duration calculation for immediate failure", async () => {
      const listener = jest.fn();
      monitoringService.onEvent(listener);

      const error = new Error("test error");
      const handler = jest.fn().mockRejectedValue(error);

      try {
        await monitoringService.trackStep("test-step", handler, context);
      } catch (e) {
        // Expected to throw
      }

      const event = listener.mock.calls[0][0];
      expect(event.duration).toBe(0); // Should be 0 for immediate execution
    });
  });
});
