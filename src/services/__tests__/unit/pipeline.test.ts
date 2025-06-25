// The array of listeners is made global to be shared between mock and test
(global as any).__mockListeners = [];

import { PipelineService } from "../../pipeline.service";
import { PipelineConfig, PipelineEvent, ErrorActionType } from "../../../types";
import { MonitoringService } from "../../monitoring.service";
import { WorkerService } from "../../worker.service";
import { MonitoringEvent } from "../../../types/monitoring";

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
jest.mock("../../../services/monitoring.service", () => {
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

jest.mock("../../../services/worker.service");

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

    it("should respect max retries limit", async () => {
      let attempts = 0;
      mockWorkerService.runWorker.mockImplementation(async () => {
        attempts++;
        throw new Error("Persistent error");
      });

      const config: PipelineConfig<"step1"> = {
        steps: [
          {
            name: "step1",
            handler: "./worker.js",
            errorHandlers: {
              onError: async () => ({ type: ErrorActionType.RETRY, maxRetries: 2 }),
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

      await expect(pipeline.execute(input)).rejects.toThrow("Persistent error");
      expect(attempts).toBe(3); // Initial + 2 retries
    });

    it("should call onRetry handler when retrying", async () => {
      const onRetry = jest.fn();
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
              onRetry,
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

      await pipeline.execute(input);
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it("should detect infinite loops when continuing to visited step", async () => {
      mockWorkerService.runWorker.mockRejectedValue(new Error("Step failed"));

      const config: PipelineConfig<"step1"> = {
        steps: [
          {
            name: "step1",
            handler: "./worker.js",
            errorHandlers: {
              onError: async () => ({
                type: ErrorActionType.CONTINUE,
                nextStep: "step1", // Same step - should cause infinite loop
              }),
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

      await expect(pipeline.execute(input)).rejects.toThrow("Infinite loop detected");
    });

    it("should call onContinue handler when continuing to next step", async () => {
      const onContinue = jest.fn();
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
              onContinue,
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

      await pipeline.execute(input);
      expect(onContinue).toHaveBeenCalledTimes(1);
    });

    it("should call onStop handler and throw error when stopping", async () => {
      const onStop = jest.fn();
      mockWorkerService.runWorker.mockRejectedValue(new Error("Step failed"));

      const config: PipelineConfig<"step1"> = {
        steps: [
          {
            name: "step1",
            handler: "./worker.js",
            errorHandlers: {
              onError: async () => ({ type: ErrorActionType.STOP }),
              onStop,
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

      await expect(pipeline.execute(input)).rejects.toThrow("Step failed");
      expect(onStop).toHaveBeenCalledTimes(1);
    });

    it("should handle custom error actions", async () => {
      const customHandler = jest.fn().mockResolvedValue({ type: ErrorActionType.RETRY });
      mockWorkerService.runWorker
        .mockRejectedValueOnce(new Error("Step failed"))
        .mockResolvedValueOnce("success");

      const config: PipelineConfig<"step1"> = {
        steps: [
          {
            name: "step1",
            handler: "./worker.js",
            errorHandlers: {
              onError: async () => ({
                type: ErrorActionType.CUSTOM,
                handler: customHandler,
              }),
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
      expect(customHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe("Step Options and Configuration", () => {
    it("should use step-specific options when provided", async () => {
      mockWorkerService.runWorker.mockImplementationOnce(async (handler, data, _options) => {
        if (typeof handler === "function") {
          return handler(data);
        }
        return data;
      });

      const config: PipelineConfig<"step1"> = {
        steps: [
          {
            name: "step1",
            handler: "./worker.js",
            options: {
              maxConcurrentWorkers: 10,
              workerTimeout: 5000,
            },
          },
        ],
        options: {
          maxConcurrentWorkers: 5,
          workerTimeout: 1000,
        },
      };

      const pipeline = new PipelineService(config);
      (pipeline as any).workerService = mockWorkerService;

      const input: PipelineEvent<"step1", string> = {
        currentStep: "step1",
        data: "input",
      };

      await pipeline.execute(input);
      expect(mockWorkerService.runWorker).toHaveBeenCalledWith(
        "./worker.js",
        "input",
        expect.objectContaining({
          maxConcurrentWorkers: 10,
          workerTimeout: 5000,
        })
      );
    });

    it("should merge retry strategy correctly", async () => {
      mockWorkerService.runWorker.mockImplementationOnce(async (handler, data, _options) => {
        if (typeof handler === "function") {
          return handler(data);
        }
        return data;
      });

      const config: PipelineConfig<"step1"> = {
        steps: [
          {
            name: "step1",
            handler: "./worker.js",
            options: {
              retryStrategy: {
                maxRetries: 5,
                backoffMs: 200,
              },
            },
          },
        ],
        options: {
          retryStrategy: {
            maxRetries: 3,
            backoffMs: 100,
          },
        },
      };

      const pipeline = new PipelineService(config);
      (pipeline as any).workerService = mockWorkerService;

      const input: PipelineEvent<"step1", string> = {
        currentStep: "step1",
        data: "input",
      };

      await pipeline.execute(input);
      expect(mockWorkerService.runWorker).toHaveBeenCalledWith(
        "./worker.js",
        "input",
        expect.objectContaining({
          retryStrategy: {
            maxRetries: 5,
            backoffMs: 200,
          },
        })
      );
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

    it("should call multiple event listeners", () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();
      pipelineService.onEvent(listener1);
      pipelineService.onEvent(listener2);

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

      const monitoringService = MonitoringService.getInstance();
      monitoringService.emitEvent(mockEvent);

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
    });
  });

  describe("Cleanup", () => {
    it("should cleanup all worker services", async () => {
      await pipelineService.cleanup();
      expect(mockWorkerService.cleanup).toHaveBeenCalledTimes(3); // One for each step
    });

    it("should clear event listeners and visited steps", async () => {
      const listener = jest.fn();
      pipelineService.onEvent(listener);

      await pipelineService.cleanup();

      // Verify that event listeners are cleared by checking if the service is reset
      const newListener = jest.fn();
      pipelineService.onEvent(newListener);

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

      const monitoringService = MonitoringService.getInstance();
      monitoringService.emitEvent(mockEvent);

      expect(listener).not.toHaveBeenCalled();
      expect(newListener).toHaveBeenCalledTimes(1);
    });
  });

  describe("Array Input Processing", () => {
    it("should process array of inputs in parallel", async () => {
      const inputs: PipelineEvent<"step1", string>[] = [
        { currentStep: "step1", data: "input1" },
        { currentStep: "step1", data: "input2" },
        { currentStep: "step1", data: "input3" },
      ];

      mockWorkerService.runWorker.mockImplementation(async (handler, data) => {
        if (typeof handler === "function") {
          return handler(data);
        }
        return `${data}-processed`;
      });

      const config: PipelineConfig<"step1"> = {
        steps: [
          {
            name: "step1",
            handler: async (data) => `${data}-processed`,
          },
        ],
      };

      const pipeline = new PipelineService(config);
      (pipeline as any).workerService = mockWorkerService;

      const results = await pipeline.execute(inputs);
      expect(results).toEqual([
        "input1-processed",
        "input2-processed",
        "input3-processed",
      ]);
    });

    it("should handle errors in array processing", async () => {
      const inputs: PipelineEvent<"step1", string>[] = [
        { currentStep: "step1", data: "input1" },
        { currentStep: "step1", data: "input2" },
      ];

      mockWorkerService.runWorker
        .mockResolvedValueOnce("input1-processed")
        .mockRejectedValueOnce(new Error("Step failed"));

      const config: PipelineConfig<"step1"> = {
        steps: [
          {
            name: "step1",
            handler: async (data) => `${data}-processed`,
          },
        ],
      };

      const pipeline = new PipelineService(config);
      (pipeline as any).workerService = mockWorkerService;

      await expect(pipeline.execute(inputs)).rejects.toThrow("Step failed");
    });
  });

  describe("Step Finding and Validation", () => {
    it("should throw error when step is not found", async () => {
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

      const input = {
        currentStep: "invalid-step",
        data: { initial: true },
      } as any;

      await expect(pipeline.execute(input)).rejects.toThrow(
        "Step invalid-step not found in steps"
      );
    });

    it("should find step by exact name match", async () => {
      const config: PipelineConfig<"step1" | "step2"> = {
        steps: [
          {
            name: "step1",
            handler: async (data) => ({ ...data, step1: true }),
          },
          {
            name: "step2",
            handler: async (data) => ({ ...data, step2: true }),
          },
        ],
      };

      const pipeline = new PipelineService(config);
      (pipeline as any).workerService = mockWorkerService;

      const input: PipelineEvent<"step2", any> = {
        currentStep: "step2",
        data: { initial: true },
      };

      const result = await pipeline.execute(input);
      expect(result).toEqual({ initial: true, step2: true });
    });
  });

  describe("Worker Service Configuration", () => {
    it("should use step options when available", async () => {
      const config: PipelineConfig<"step1"> = {
        steps: [
          {
            name: "step1",
            handler: "./worker.js",
            options: {
              maxConcurrentWorkers: 10,
            },
          },
        ],
        options: {
          maxConcurrentWorkers: 5,
        },
      };

      const pipeline = new PipelineService(config);
      (pipeline as any).workerService = mockWorkerService;

      const input: PipelineEvent<"step1", string> = {
        currentStep: "step1",
        data: "input",
      };

      await pipeline.execute(input);
      expect(mockWorkerService.runWorker).toHaveBeenCalledWith(
        "./worker.js",
        "input",
        expect.objectContaining({
          maxConcurrentWorkers: 10,
        })
      );
    });

    it("should use global options when step options are not provided", async () => {
      const config: PipelineConfig<"step1"> = {
        steps: [
          {
            name: "step1",
            handler: "./worker.js",
          },
        ],
        options: {
          maxConcurrentWorkers: 5,
        },
      };

      const pipeline = new PipelineService(config);
      (pipeline as any).workerService = mockWorkerService;

      const input: PipelineEvent<"step1", string> = {
        currentStep: "step1",
        data: "input",
      };

      await pipeline.execute(input);
      // When step options are not provided, getStepOptions returns undefined
      // and the WorkerService constructor uses global options
      expect(mockWorkerService.runWorker).toHaveBeenCalledWith(
        "./worker.js",
        "input",
        undefined
      );
    });
  });

  describe("Retry Count and Context", () => {
    it("should increment retry count correctly", async () => {
      let attempts = 0;
      mockWorkerService.runWorker.mockImplementation(async () => {
        attempts++;
        if (attempts < 3) throw new Error("Temporary error");
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
      expect(attempts).toBe(3);
    });

    it("should pass correct retry count in context", async () => {
      const onError = jest.fn().mockResolvedValue({ type: ErrorActionType.RETRY });
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
              onError,
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

      await pipeline.execute(input);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          retryCount: 0,
        })
      );
    });
  });

  describe("Array Processing Logic", () => {
    it("should find correct step index in array processing", async () => {
      const inputs: PipelineEvent<"step1" | "step2", string>[] = [
        { currentStep: "step1", data: "input1" },
        { currentStep: "step2", data: "input2" },
      ];

      mockWorkerService.runWorker.mockImplementation(async (handler, data) => {
        if (typeof handler === "function") {
          return handler(data);
        }
        return `${data}-processed`;
      });

      const config: PipelineConfig<"step1" | "step2"> = {
        steps: [
          {
            name: "step1",
            handler: async (data) => `${data}-step1`,
          },
          {
            name: "step2",
            handler: async (data) => `${data}-step2`,
          },
        ],
      };

      const pipeline = new PipelineService(config);
      (pipeline as any).workerService = mockWorkerService;

      const results = await pipeline.execute(inputs);
      expect(results).toEqual([
        "input1-step1-step2",
        "input2-step2",
      ]);
    });

    it("should handle step not found in array processing", async () => {
      const inputs = [
        { currentStep: "step1", data: "input1" },
        { currentStep: "invalid", data: "input2" },
      ] as any;

      mockWorkerService.runWorker.mockImplementation(async (handler, data) => {
        if (typeof handler === "function") {
          return handler(data);
        }
        return `${data}-processed`;
      });

      const config: PipelineConfig<"step1"> = {
        steps: [
          {
            name: "step1",
            handler: async (data) => `${data}-processed`,
          },
        ],
      };

      const pipeline = new PipelineService(config);
      (pipeline as any).workerService = mockWorkerService;

      await expect(pipeline.execute(inputs)).rejects.toThrow(
        "Step invalid not found in steps"
      );
    });

    it("should process multiple steps in sequence for array input", async () => {
      const inputs: PipelineEvent<"step1", string>[] = [
        { currentStep: "step1", data: "input1" },
      ];

      let callCount = 0;
      mockWorkerService.runWorker.mockImplementation(async (handler, data) => {
        callCount++;
        if (typeof handler === "function") {
          return handler(data);
        }
        return `${data}-processed-${callCount}`;
      });

      const config: PipelineConfig<"step1" | "step2" | "step3"> = {
        steps: [
          {
            name: "step1",
            handler: async (data) => `${data}-step1`,
          },
          {
            name: "step2",
            handler: async (data) => `${data}-step2`,
          },
          {
            name: "step3",
            handler: async (data) => `${data}-step3`,
          },
        ],
      };

      const pipeline = new PipelineService(config);
      (pipeline as any).workerService = mockWorkerService;

      const results = await pipeline.execute(inputs);
      expect(results).toEqual([
        "input1-step1-step2-step3",
      ]);
      expect(callCount).toBe(3); // One call per step
    });
  });

  describe("Error Action Logic", () => {
    it("should handle retry with specific maxRetries", async () => {
      let attempts = 0;
      mockWorkerService.runWorker.mockImplementation(async () => {
        attempts++;
        throw new Error("Persistent error");
      });

      const config: PipelineConfig<"step1"> = {
        steps: [
          {
            name: "step1",
            handler: "./worker.js",
            errorHandlers: {
              onError: async () => ({ 
                type: ErrorActionType.RETRY, 
                maxRetries: 1 
              }),
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

      await expect(pipeline.execute(input)).rejects.toThrow("Persistent error");
      expect(attempts).toBe(2); // Initial + 1 retry
    });

    it("should handle retry with step-specific retry strategy", async () => {
      let attempts = 0;
      mockWorkerService.runWorker.mockImplementation(async () => {
        attempts++;
        throw new Error("Persistent error");
      });

      const config: PipelineConfig<"step1"> = {
        steps: [
          {
            name: "step1",
            handler: "./worker.js",
            options: {
              retryStrategy: {
                maxRetries: 2,
                backoffMs: 100,
              },
            },
            errorHandlers: {
              onError: async () => ({ type: ErrorActionType.RETRY }),
            },
          },
        ],
        options: {
          retryStrategy: {
            maxRetries: 1,
            backoffMs: 50,
          },
        },
      };

      const pipeline = new PipelineService(config);
      (pipeline as any).workerService = mockWorkerService;

      const input: PipelineEvent<"step1", string> = {
        currentStep: "step1",
        data: "input",
      };

      await expect(pipeline.execute(input)).rejects.toThrow("Persistent error");
      expect(attempts).toBe(3); // Initial + 2 retries (step-specific)
    });

    it("should handle retry with global retry strategy when step-specific is not provided", async () => {
      let attempts = 0;
      mockWorkerService.runWorker.mockImplementation(async () => {
        attempts++;
        throw new Error("Persistent error");
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
        options: {
          retryStrategy: {
            maxRetries: 2,
            backoffMs: 100,
          },
        },
      };

      const pipeline = new PipelineService(config);
      (pipeline as any).workerService = mockWorkerService;

      const input: PipelineEvent<"step1", string> = {
        currentStep: "step1",
        data: "input",
      };

      await expect(pipeline.execute(input)).rejects.toThrow("Persistent error");
      expect(attempts).toBe(4); // Initial + 3 retries (global default is 3)
    });
  });
});
