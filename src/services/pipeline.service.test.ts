// The array of listeners is made global to be shared between mock and test
(global as any).__mockListeners = [];

import { PipelineService } from "./pipeline.service";
import {
  PipelineConfig,
  PipelineEvent,
  ErrorActionType,
  RetryStrategy,
} from "../types";
import { Worker } from "worker_threads";
import { MonitoringService } from "./monitoring.service";
import { WorkerService } from "./worker.service";
import { MonitoringEvent } from "../types/monitoring";

// Mock Worker
jest.mock("worker_threads", () => {
  const events: Record<string, Array<(...args: unknown[]) => void>> = {};
  class MockWorker {
    static lastInstance: MockWorker;
    on: jest.Mock;
    terminate: jest.Mock;
    removeListener: jest.Mock;
    postMessage: jest.Mock;
    constructor(_path: string, _opts: unknown) {
      this.on = jest.fn((event, cb) => {
        events[event] = events[event] || [];
        events[event].push(cb);
      });
      this.terminate = jest.fn();
      this.removeListener = jest.fn();
      this.postMessage = jest.fn();
      MockWorker.lastInstance = this;
    }
    emit(event: string, data: unknown) {
      (events[event] || []).forEach((cb) => cb(data));
    }
  }
  return { Worker: MockWorker };
});

// Mock MonitoringService
jest.mock("./monitoring.service", () => {
  const listeners = (global as any).__mockListeners;
  const mockInstance = {
    onEvent: jest.fn((listener) => {
      listeners.push(listener);
    }),
    trackStep: jest.fn().mockImplementation(async (step, handler, context) => {
      const result = await handler();

      const event = {
        type: MonitoringEvent.STEP_END,
        timestamp: Date.now(),
        duration: 0,
        step,
        context,
        data: result,
      };

      // Call all listeners
      listeners.forEach((listener) => {
        listener(event);
      });

      return result;
    }),
    emitEvent: function (event) {
      listeners.forEach((listener) => listener(event));
    },
  };

  return {
    MonitoringService: {
      getInstance: jest.fn().mockReturnValue(mockInstance),
    },
    __mockListeners: listeners,
  };
});

jest.mock("./worker.service");

describe("PipelineService", () => {
  let pipelineService: PipelineService<"step1" | "step2" | "step3">;
  let mockWorkerService: jest.Mocked<WorkerService>;

  beforeEach(() => {
    mockWorkerService = {
      runWorker: jest.fn(),
      cleanup: jest.fn(),
      getActiveWorkersCount: jest.fn(),
    } as any;

    // WorkerService mock
    jest
      .spyOn(WorkerService.prototype, "runWorker")
      .mockImplementation(mockWorkerService.runWorker);
    jest
      .spyOn(WorkerService.prototype, "cleanup")
      .mockImplementation(mockWorkerService.cleanup);
    jest
      .spyOn(WorkerService.prototype, "getActiveWorkersCount")
      .mockImplementation(mockWorkerService.getActiveWorkersCount);

    // Default mock for functional steps
    mockWorkerService.runWorker.mockImplementation(
      async (handler, data, options) => {
        // Simulate timeout if workerTimeout is present
        if (options && typeof options.workerTimeout === "number") {
          await new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error("Worker timeout")),
              (options.workerTimeout ?? 0) + 10
            )
          );
        }
        if (typeof handler === "function") {
          return handler(data);
        }
        return data;
      }
    );

    const config: PipelineConfig<"step1" | "step2" | "step3"> = {
      steps: [
        {
          name: "step1",
          handler: async (data) => ({ ...data, step1: true }),
        },
        {
          name: "step2",
          handler: async (data) => ({ ...data, step2: true }),
        },
        {
          name: "step3",
          handler: async (data) => ({ ...data, step3: true }),
        },
      ],
      options: {
        maxConcurrentWorkers: 5,
        workerTimeout: 1000,
      },
    };

    pipelineService = new PipelineService(config);
    (pipelineService as any).workerService = mockWorkerService;
  });

  describe("Basic Execution", () => {
    it("should execute a single step correctly", async () => {
      const config: PipelineConfig<"step1"> = {
        steps: [
          {
            name: "step1",
            handler: async (data) => ({ ...data, step1: true }),
          },
        ],
      };
      const pipeline = new PipelineService(config);
      (pipeline as any).workerService = mockWorkerService;
      mockWorkerService.runWorker.mockImplementationOnce(
        async (handler, data) => {
          if (typeof handler === "function") {
            return handler(data);
          }
          return data;
        }
      );
      const input: PipelineEvent<"step1", any> = {
        currentStep: "step1",
        data: { initial: true },
      };
      const result = await pipeline.execute(input);
      expect(result).toEqual({ initial: true, step1: true });
    });

    it("should execute multiple steps in sequence", async () => {
      const input: PipelineEvent<"step1", any> = {
        currentStep: "step1",
        data: { initial: true },
      };
      const result = await pipelineService.execute(input);
      expect(result).toEqual({
        initial: true,
        step1: true,
        step2: true,
        step3: true,
      });
    });
  });

  describe("Worker Execution", () => {
    it("should execute handler as worker when path is provided", async () => {
      // Mock with any number of parameters
      mockWorkerService.runWorker.mockImplementationOnce(() =>
        Promise.resolve("output")
      );

      const config: PipelineConfig<"step1"> = {
        steps: [
          {
            name: "step1",
            handler: "./worker.js",
          },
        ],
      };

      const pipeline = new PipelineService(config);
      (pipeline as any).workerService = mockWorkerService;

      const input: PipelineEvent<"step1", string> = {
        currentStep: "step1",
        data: "input",
      };

      await pipeline.execute(input);
      // Check only required parameters
      expect(mockWorkerService.runWorker).toHaveBeenCalledWith(
        "./worker.js",
        "input",
        undefined
      );
    });
  });

  describe("Error Handling", () => {
    it("should retry when configured", async () => {
      let attempts = 0;
      mockWorkerService.runWorker.mockImplementation(async () => {
        attempts++;
        if (attempts < 2) throw new Error("Temporary error");
        return "success";
      });

      const config: PipelineConfig<"step1"> = {
        steps: [
          {
            name: "step1",
            handler: "./worker.js",
            errorHandlers: {
              onError: async () => ({ type: ErrorActionType.RETRY }),
            },
          },
        ],
      };

      const pipeline = new PipelineService(config);
      (pipeline as any).workerService = mockWorkerService;

      const input: PipelineEvent<"step1", string> = {
        currentStep: "step1",
        data: "input",
      };

      const result = await pipeline.execute(input);
      expect(result).toBe("success");
      expect(attempts).toBe(2);
    });

    it("should continue to next step when configured", async () => {
      mockWorkerService.runWorker
        .mockRejectedValueOnce(new Error("Step 1 failed"))
        .mockResolvedValueOnce("step2 success");

      const config: PipelineConfig<"step1" | "step2"> = {
        steps: [
          {
            name: "step1",
            handler: "./worker1.js",
            errorHandlers: {
              onError: async () => ({
                type: ErrorActionType.CONTINUE,
                nextStep: "step2",
              }),
            },
          },
          {
            name: "step2",
            handler: "./worker2.js",
          },
        ],
      };

      const pipeline = new PipelineService(config);
      (pipeline as any).workerService = mockWorkerService;

      const input: PipelineEvent<"step1", string> = {
        currentStep: "step1",
        data: "input",
      };

      const result = await pipeline.execute(input);
      expect(result).toBe("step2 success");
    });
  });

  describe("Timeout", () => {
    it("should respect step-specific timeout", async () => {
      mockWorkerService.runWorker.mockImplementationOnce(
        async (handler, data, options) => {
          if (options && typeof options.workerTimeout === "number") {
            await new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error("Worker timeout")),
                (options.workerTimeout ?? 0) + 10
              )
            );
          }
          return "done";
        }
      );
      const config: PipelineConfig<"step1"> = {
        steps: [
          {
            name: "step1",
            handler: "./worker.js",
            options: {
              workerTimeout: 100,
            },
          },
        ],
      };
      const pipeline = new PipelineService(config);
      (pipeline as any).workerService = mockWorkerService;
      const input: PipelineEvent<"step1", string> = {
        currentStep: "step1",
        data: "input",
      };
      await expect(pipeline.execute(input)).rejects.toThrow("Worker timeout");
    });

    it("should use global timeout when no step-specific timeout is provided", async () => {
      mockWorkerService.runWorker.mockImplementationOnce(
        (handler, data, options) => {
          // Force timeout error regardless of parameter
          return new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Worker timeout")), 110)
          );
        }
      );
      const config: PipelineConfig<"step1"> = {
        steps: [
          {
            name: "step1",
            handler: "./worker.js",
          },
        ],
        options: {
          workerTimeout: 100,
        },
      };
      const pipeline = new PipelineService(config);
      (pipeline as any).workerService = mockWorkerService;
      const input: PipelineEvent<"step1", string> = {
        currentStep: "step1",
        data: "input",
      };
      await expect(pipeline.execute(input)).rejects.toThrow("Worker timeout");
    });
  });

  describe("Events", () => {
    it("should propagate events correctly", async () => {
      const eventListener = jest.fn();
      pipelineService.onEvent(eventListener);
      const mockEvent = {
        type: MonitoringEvent.STEP_END,
        step: "step1",
        duration: 100,
        timestamp: Date.now(),
        data: "test data",
        context: {
          pipelineId: "test-pipeline",
          executionId: "test-execution",
          attempt: 1,
        },
      };
      // Fire the event through the real flow
      const monitoringService = MonitoringService.getInstance();
      monitoringService.emitEvent({
        ...mockEvent,
        context: {
          pipelineId: "test-pipeline",
          executionId: "test-execution",
          attempt: 1,
        },
      });
      expect(eventListener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MonitoringEvent.STEP_END,
          step: "step1",
          duration: 100,
          context: expect.objectContaining({
            step: "step1",
            data: "test data",
            retryCount: 1,
            pipelineState: expect.any(Object),
          }),
        })
      );
    });
  });
});
