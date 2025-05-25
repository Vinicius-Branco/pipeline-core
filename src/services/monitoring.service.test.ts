import { MonitoringService } from "./monitoring.service";
import { MonitoringEvent } from "../types/monitoring";

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
      expect(event.duration).toBeGreaterThanOrEqual(100);
    });
  });
});
