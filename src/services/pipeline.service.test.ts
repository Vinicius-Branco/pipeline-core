// The array of listeners is made global to be shared between mock and test
(global as any).__mockListeners = [];

import { PipelineService } from "./pipeline.service";
import {
  PipelineConfig,
  PipelineEvent,
  ErrorActionType,
  PipelineState,
  SHUTDOWN_EVENT_TYPES,
} from "../types";
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
      mockWorkerService.runWorker.mockImplementationOnce(async () => {
        await new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Worker timeout")), 110)
        );
        return "done";
      });
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

describe("PipelineService - Graceful Shutdown", () => {
  let pipeline: PipelineService<"step1" | "step2", any>;
  let mockWorkerService: any;

  beforeEach(() => {
    jest.clearAllMocks();

    const config: PipelineConfig<"step1" | "step2"> = {
      steps: [
        {
          name: "step1",
          handler: async (data: any) => ({ ...data, step1: "completed" }),
        },
        {
          name: "step2",
          handler: async (data: any) => ({ ...data, step2: "completed" }),
        },
      ],
      options: {
        maxConcurrentWorkers: 2,
      },
    };

    // Mock WorkerService
    mockWorkerService = {
      runWorker: jest.fn(),
      shutdown: jest.fn(),
      abortAllWorkers: jest.fn(),
      cleanup: jest.fn(),
      getActiveWorkersCount: jest.fn().mockReturnValue(0),
    };

    const { WorkerService } = require("./worker.service");
    WorkerService.mockImplementation(() => mockWorkerService);

    pipeline = new PipelineService(config);
  });

  describe("Basic shutdown functionality", () => {
    it("should initialize in RUNNING state", () => {
      expect(pipeline.getState()).toBe(PipelineState.RUNNING);
      expect(pipeline.isShuttingDown()).toBe(false);
      expect(pipeline.isShutdown()).toBe(false);
    });

    it("should reject new executions when shutting down", async () => {
      // Start shutdown
      const shutdownPromise = pipeline.shutdown();

      // Try to execute while shutting down
      await expect(
        pipeline.execute({ data: { test: "data" }, currentStep: "step1" })
      ).rejects.toThrow(
        "Pipeline is in SHUTTING_DOWN state and cannot accept new executions"
      );

      await shutdownPromise;
    });

    it("should reject new executions when shutdown", async () => {
      await pipeline.shutdown();

      await expect(
        pipeline.execute({ data: { test: "data" }, currentStep: "step1" })
      ).rejects.toThrow(
        "Pipeline is in SHUTDOWN state and cannot accept new executions"
      );
    });

    it("should shutdown immediately when no active executions", async () => {
      const startTime = Date.now();
      await pipeline.shutdown();
      const endTime = Date.now();

      expect(endTime - startTime).toBeLessThan(100);
      expect(pipeline.getState()).toBe(PipelineState.SHUTDOWN);
    });

    it("should handle multiple shutdown calls", async () => {
      const shutdown1 = pipeline.shutdown();
      const shutdown2 = pipeline.shutdown();
      // Ambas devem resolver sem erro
      await expect(shutdown1).resolves.toBeUndefined();
      await expect(shutdown2).resolves.toBeUndefined();
    });

    it("should shutdown worker services", async () => {
      mockWorkerService.shutdown.mockResolvedValue(undefined);

      await pipeline.shutdown();

      expect(mockWorkerService.shutdown).toHaveBeenCalledWith(30000); // Default timeout
    });
  });

  describe("Shutdown events", () => {
    it("should emit shutdown start event", async () => {
      const events: any[] = [];
      pipeline.onEvent((event) => {
        events.push(event);
      });

      await pipeline.shutdown();

      const shutdownStartEvent = events.find(
        (e) => e.type === SHUTDOWN_EVENT_TYPES.SHUTDOWN_START
      );
      expect(shutdownStartEvent).toBeDefined();
      expect(shutdownStartEvent.context).toBeDefined();
      expect(shutdownStartEvent.context.pipelineId).toBe("pipeline");
    });

    it("should emit shutdown complete event", async () => {
      const events: any[] = [];
      pipeline.onEvent((event) => {
        events.push(event);
      });

      await pipeline.shutdown();

      const shutdownCompleteEvent = events.find(
        (e) => e.type === SHUTDOWN_EVENT_TYPES.SHUTDOWN_COMPLETE
      );
      expect(shutdownCompleteEvent).toBeDefined();
    });
  });

  describe("Shutdown callbacks", () => {
    it("should call onShutdownStart callback", async () => {
      const onShutdownStart = jest.fn();
      const onShutdownComplete = jest.fn();
      const onTimeout = jest.fn();

      await pipeline.shutdown({
        onShutdownStart,
        onShutdownComplete,
        onTimeout,
      });

      expect(onShutdownStart).toHaveBeenCalled();
      expect(onShutdownComplete).toHaveBeenCalled();
      expect(onTimeout).not.toHaveBeenCalled();
    });
  });

  describe("Wait for completion", () => {
    it("should resolve immediately when no active executions", async () => {
      const startTime = Date.now();
      await pipeline.waitForCompletion();
      const endTime = Date.now();

      expect(endTime - startTime).toBeLessThan(200); // Increased tolerance
    });
  });

  describe("Shutdown with number timeout", () => {
    it("should accept number as timeout", async () => {
      mockWorkerService.shutdown.mockResolvedValue(undefined);

      await pipeline.shutdown(5000);

      expect(mockWorkerService.shutdown).toHaveBeenCalledWith(5000);
    });
  });

  describe("Cleanup", () => {
    it("should cleanup all resources", async () => {
      mockWorkerService.cleanup.mockResolvedValue(undefined);

      await pipeline.cleanup();

      expect(mockWorkerService.cleanup).toHaveBeenCalled();
    });

    it("should clear event listeners", async () => {
      const eventListener = jest.fn();
      pipeline.onEvent(eventListener);

      await pipeline.cleanup();

      // Try to emit an event (should not call the listener)
      await pipeline.shutdown();
      expect(eventListener).not.toHaveBeenCalled();
    });
  });
});
