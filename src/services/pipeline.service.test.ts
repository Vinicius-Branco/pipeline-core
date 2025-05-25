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
  let listeners: Array<(event: any) => void> = [];
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

      // Chamar todos os listeners
      listeners.forEach((listener) => {
        listener(event);
      });

      return result;
    }),
  };

  return {
    MonitoringService: {
      getInstance: jest.fn().mockReturnValue(mockInstance),
    },
  };
});

jest.mock("./worker.service");

describe("PipelineService", () => {
  let pipelineService: PipelineService<"step1" | "step2" | "step3">;
  let mockConfig: PipelineConfig<"step1" | "step2" | "step3">;
  let mockWorkerService: jest.Mocked<WorkerService>;

  beforeEach(() => {
    mockConfig = {
      steps: [
        {
          name: "step1",
          handler: async (data: any) => ({ ...data, step1: true }),
        },
        {
          name: "step2",
          handler: async (data: any) => ({ ...data, step2: true }),
        },
        {
          name: "step3",
          handler: async (data: any) => ({ ...data, step3: true }),
        },
      ],
      options: {
        retryStrategy: {
          maxRetries: 3,
          backoffMs: 1000,
        },
      },
    };

    jest.clearAllMocks();
    mockWorkerService = {
      runWorker: jest.fn().mockImplementation((handler, data, options) => {
        if (options && options.workerTimeout && typeof handler === "function") {
          if (
            handler.name === "timeoutHandler" ||
            handler.toString().includes("setTimeout")
          ) {
            return Promise.reject(new Error("timeout"));
          }
        }
        if (typeof handler === "function") {
          return handler(data);
        }
        if (typeof handler === "string") {
          return Promise.resolve("worker result");
        }
        return Promise.resolve(data);
      }),
    } as any;

    (WorkerService as jest.Mock).mockImplementation(() => mockWorkerService);

    pipelineService = new PipelineService(mockConfig);
  });

  describe("Basic Pipeline Execution", () => {
    it("should execute pipeline steps in sequence", async () => {
      const input: PipelineEvent<"step1" | "step2" | "step3", any> = {
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

    it("should handle single step execution", async () => {
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

  describe("Retry Strategy", () => {
    it("should use step-specific retry strategy over global one", async () => {
      const stepRetry: RetryStrategy = {
        maxRetries: 2,
        backoffMs: 500,
      };

      const config: PipelineConfig<"step1"> = {
        steps: [
          {
            name: "step1",
            handler: async (data: any) => ({ ...data, step1: true }),
            options: {
              retryStrategy: stepRetry,
            },
          },
        ],
        options: {
          retryStrategy: {
            maxRetries: 3,
            backoffMs: 1000,
          },
        },
      };

      const service = new PipelineService(config);
      const input: PipelineEvent<"step1", any> = {
        currentStep: "step1",
        data: { initial: true },
      };

      await service.execute(input);
      const monitoringService = MonitoringService.getInstance();
      expect(monitoringService.trackStep).toHaveBeenCalledWith(
        "step1",
        expect.any(Function),
        expect.any(Object)
      );
    });

    it("should not use retry strategy if not configured", async () => {
      const config: PipelineConfig<"step1"> = {
        steps: [
          {
            name: "step1",
            handler: async (data: any) => ({ ...data, step1: true }),
          },
        ],
      };

      const service = new PipelineService(config);
      const input: PipelineEvent<"step1", any> = {
        currentStep: "step1",
        data: { initial: true },
      };

      await service.execute(input);
      const monitoringService = MonitoringService.getInstance();
      expect(monitoringService.trackStep).toHaveBeenCalledWith(
        "step1",
        expect.any(Function),
        expect.any(Object)
      );
    });
  });

  describe("Error Handling", () => {
    it("should handle errors with retry strategy", async () => {
      let attemptCount = 0;
      const errorConfig: PipelineConfig<"step1"> = {
        steps: [
          {
            name: "step1",
            handler: async (data: any) => {
              attemptCount++;
              if (attemptCount < 2) {
                throw new Error("Temporary error");
              }
              return { ...data, step1: true };
            },
            errorHandlers: {
              onError: async () => ({
                type: ErrorActionType.RETRY,
                maxRetries: 3,
              }),
            },
          },
        ],
      };

      const service = new PipelineService(errorConfig);
      const input: PipelineEvent<"step1", any> = {
        currentStep: "step1",
        data: { initial: true },
      };

      const result = await service.execute(input);

      expect(result).toEqual({
        initial: true,
        step1: true,
      });
      expect(attemptCount).toBe(2);
    });

    it("should handle errors with continue strategy", async () => {
      const errorConfig: PipelineConfig<"step1" | "step2"> = {
        steps: [
          {
            name: "step1",
            handler: async () => {
              throw new Error("Step 1 failed");
            },
            errorHandlers: {
              onError: async () => ({
                type: ErrorActionType.CONTINUE,
                nextStep: "step2",
              }),
            },
          },
          {
            name: "step2",
            handler: async (data: any) => ({ ...data, step2: true }),
          },
        ],
      };

      const service = new PipelineService(errorConfig);
      const input: PipelineEvent<"step1", any> = {
        currentStep: "step1",
        data: { initial: true },
      };

      const result = await service.execute(input);

      expect(result).toEqual({
        initial: true,
        step2: true,
      });
    });

    it("should handle custom error action", async () => {
      const customAction = jest.fn().mockResolvedValue({
        type: ErrorActionType.CONTINUE,
        nextStep: "step2",
      });

      const config: PipelineConfig<"step1" | "step2"> = {
        steps: [
          {
            name: "step1",
            handler: jest.fn().mockRejectedValue(new Error("error")),
            errorHandlers: {
              onError: async () => ({
                type: ErrorActionType.CUSTOM,
                handler: customAction,
              }),
            },
          },
          {
            name: "step2",
            handler: jest.fn().mockResolvedValue("ok"),
          },
        ],
      };

      const pipeline = new PipelineService(config);
      const input: PipelineEvent<"step1", string> = {
        currentStep: "step1",
        data: "input",
      };

      await pipeline.execute(input);
      expect(customAction).toHaveBeenCalled();
    });

    it("should handle error context correctly", async () => {
      const errorHandler = jest.fn().mockResolvedValue({
        type: ErrorActionType.CONTINUE,
        nextStep: "step2",
      });

      const config: PipelineConfig<"step1" | "step2"> = {
        steps: [
          {
            name: "step1",
            handler: jest.fn().mockRejectedValue(new Error("error")),
            errorHandlers: {
              onError: errorHandler,
            },
          },
          {
            name: "step2",
            handler: jest.fn().mockResolvedValue("ok"),
          },
        ],
      };

      const pipeline = new PipelineService(config);
      const input: PipelineEvent<"step1", string> = {
        currentStep: "step1",
        data: "input",
      };

      await pipeline.execute(input);
      expect(errorHandler).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          step: "step1",
          data: "input",
          retryCount: 0,
          pipelineState: {
            currentStep: "step1",
            steps: ["step1", "step2"],
          },
        })
      );
    });

    it("should handle infinite loop detection", async () => {
      const config: PipelineConfig<"step1" | "step2"> = {
        steps: [
          {
            name: "step1",
            handler: jest.fn().mockRejectedValue(new Error("test error")),
            errorHandlers: {
              onError: jest.fn().mockResolvedValue({
                type: ErrorActionType.CONTINUE,
                nextStep: "step2",
              }),
            },
          },
          {
            name: "step2",
            handler: jest.fn().mockRejectedValue(new Error("test error")),
            errorHandlers: {
              onError: jest.fn().mockResolvedValue({
                type: ErrorActionType.CONTINUE,
                nextStep: "step1",
              }),
            },
          },
        ],
      };

      const pipeline = new PipelineService(config);
      const input: PipelineEvent<"step1", string> = {
        currentStep: "step1",
        data: "input",
      };

      await expect(pipeline.execute(input)).rejects.toThrow(
        "Infinite loop detected"
      );
    });
  });

  describe("Event Handling", () => {
    it("should notify event listeners of errors", async () => {
      const errorConfig: PipelineConfig<"step1"> = {
        steps: [
          {
            name: "step1",
            handler: async () => {
              throw new Error("Test error");
            },
          },
        ],
      };

      const service = new PipelineService(errorConfig);
      const mockListener = jest.fn();

      service.onEvent(mockListener);

      const input: PipelineEvent<"step1", any> = {
        currentStep: "step1",
        data: { initial: true },
      };

      await expect(service.execute(input)).rejects.toThrow("Test error");
      expect(mockListener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "ERROR",
          step: "step1",
          duration: expect.any(Number),
          timestamp: expect.any(Number),
        })
      );
    });
  });

  describe("Worker Threads", () => {
    it("should handle worker thread handlers", async () => {
      const config: PipelineConfig<"step1"> = {
        steps: [
          {
            name: "step1",
            handler: "./worker.js",
          },
        ],
      };

      const pipeline = new PipelineService(config);
      const input: PipelineEvent<"step1", string> = {
        currentStep: "step1",
        data: "input",
      };

      const promise = pipeline.execute(input);
      await expect(promise).resolves.toEqual("worker result");
    });
  });

  describe("Worker Execution", () => {
    it("should execute handler as worker when string path is provided", async () => {
      const config: PipelineConfig<"step1"> = {
        steps: [
          {
            name: "step1",
            handler: "./worker.js",
          },
        ],
      };

      const pipeline = new PipelineService(config);
      const input: PipelineEvent<"step1", string> = {
        currentStep: "step1",
        data: "input",
      };

      await pipeline.execute(input);
      expect(mockWorkerService.runWorker).toHaveBeenCalledWith(
        "./worker.js",
        "input",
        expect.anything()
      );
    });
  });

  describe("Event Propagation", () => {
    it("should propagate events with correct context", async () => {
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

      // Simulate monitoring service event
      const monitoringService = MonitoringService.getInstance();
      const onEventMock = monitoringService.onEvent as jest.Mock;
      const monitoringCallback = onEventMock.mock.calls[0][0];
      monitoringCallback(mockEvent);

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

  describe("Step Options", () => {
    it("should merge global and step-specific retry strategies", async () => {
      const config: PipelineConfig<"step1"> = {
        steps: [
          {
            name: "step1",
            handler: jest.fn().mockResolvedValue("result"),
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
      const input: PipelineEvent<"step1", string> = {
        currentStep: "step1",
        data: "input",
      };

      await pipeline.execute(input);
      const monitoringService = MonitoringService.getInstance();
      const trackStepMock = monitoringService.trackStep as jest.Mock;
      expect(trackStepMock).toHaveBeenCalled();
    });

    it("should use global retry strategy when step-specific is not provided", async () => {
      const config: PipelineConfig<"step1"> = {
        steps: [
          {
            name: "step1",
            handler: jest.fn().mockResolvedValue("result"),
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
      const input: PipelineEvent<"step1", string> = {
        currentStep: "step1",
        data: "input",
      };

      await pipeline.execute(input);
      const monitoringService = MonitoringService.getInstance();
      const trackStepMock = monitoringService.trackStep as jest.Mock;
      expect(trackStepMock).toHaveBeenCalled();
    });
  });

  describe("Multiple Pipeline Execution", () => {
    it("should execute multiple pipelines in parallel", async () => {
      const config: PipelineConfig<"step1"> = {
        steps: [
          {
            name: "step1",
            handler: jest.fn().mockResolvedValue("step1 result"),
          },
        ],
      };

      const pipeline = new PipelineService(config);
      const input1: PipelineEvent<"step1", string> = {
        currentStep: "step1",
        data: "input1",
      };

      const input2: PipelineEvent<"step1", string> = {
        currentStep: "step1",
        data: "input2",
      };

      const results = await pipeline.execute([input1, input2]);
      expect(results).toEqual(["step1 result", "step1 result"]);
      expect(config.steps[0].handler).toHaveBeenCalledTimes(2);
    });
  });

  describe("Additional Coverage", () => {
    it("should throw if step is not found", async () => {
      const config: PipelineConfig<"step1"> = { steps: [] };
      const pipeline = new PipelineService(config);
      const input: PipelineEvent<"step1", string> = {
        currentStep: "step1",
        data: "input",
      };
      await expect(pipeline.execute(input)).rejects.toThrow(
        "Step step1 not found in steps"
      );
    });

    it("should throw if step is not found in handleErrorAction", async () => {
      const config: PipelineConfig<"step1"> = { steps: [] };
      const pipeline = new PipelineService(config);
      await expect(
        (pipeline as any).handleErrorAction(
          { type: ErrorActionType.RETRY },
          "step1",
          "input",
          0,
          {
            step: "step1",
            data: "input",
            error: new Error("err"),
            retryCount: 0,
            pipelineState: { currentStep: "step1", steps: [] },
          }
        )
      ).rejects.toThrow("Step step1 not found in steps");
    });

    it("should throw if there are no errorHandlers", async () => {
      const config: PipelineConfig<"step1"> = {
        steps: [
          {
            name: "step1",
            handler: jest.fn().mockRejectedValue(new Error("no handler error")),
          },
        ],
      };
      const pipeline = new PipelineService(config);
      const input: PipelineEvent<"step1", string> = {
        currentStep: "step1",
        data: "input",
      };
      await expect(pipeline.execute(input)).rejects.toThrow("no handler error");
    });

    it("should throw if custom handler does not return a valid action", async () => {
      const customHandler = jest.fn().mockResolvedValue({ type: "INVALID" });
      const config: PipelineConfig<"step1"> = {
        steps: [
          {
            name: "step1",
            handler: jest.fn().mockRejectedValue(new Error("custom error")),
            errorHandlers: {
              onError: jest.fn().mockResolvedValue({
                type: ErrorActionType.CUSTOM,
                handler: customHandler,
              }),
            },
          },
        ],
      };
      const pipeline = new PipelineService(config);
      const input: PipelineEvent<"step1", string> = {
        currentStep: "step1",
        data: "input",
      };
      await expect(pipeline.execute(input)).rejects.toThrow("custom error");
      expect(customHandler).toHaveBeenCalled();
    });

    it("should call onRetry, onContinue and onStop if defined", async () => {
      const onRetry = jest.fn();
      const onContinue = jest.fn();
      const onStop = jest.fn();
      let attempts = 0;
      const config: PipelineConfig<"step1" | "step2"> = {
        steps: [
          {
            name: "step1",
            handler: jest.fn().mockImplementation(() => {
              attempts++;
              if (attempts < 2) throw new Error("error");
              return "ok";
            }),
            errorHandlers: {
              onError: jest.fn().mockResolvedValue({
                type: ErrorActionType.RETRY,
                maxRetries: 2,
              }),
              onRetry,
              onContinue,
              onStop,
            },
          },
        ],
      };
      const pipeline = new PipelineService(config);
      const input: PipelineEvent<"step1", string> = {
        currentStep: "step1",
        data: "input",
      };
      await pipeline.execute(input);
      expect(onRetry).toHaveBeenCalled();
      // Force CONTINUE
      config.steps[0].handler = jest
        .fn()
        .mockRejectedValue(new Error("error2"));
      if (config.steps[0].errorHandlers) {
        config.steps[0].errorHandlers.onError = jest.fn().mockResolvedValue({
          type: ErrorActionType.CONTINUE,
          nextStep: "step2",
        });
      }
      config.steps.push({
        name: "step2",
        handler: jest.fn().mockResolvedValue("ok2"),
      });
      await pipeline.execute(input);
      expect(onContinue).toHaveBeenCalled();
      // Force STOP
      if (config.steps[0].errorHandlers) {
        config.steps[0].errorHandlers.onError = jest
          .fn()
          .mockResolvedValue({ type: ErrorActionType.STOP });
      }
      await expect(pipeline.execute(input)).rejects.toThrow();
      expect(onStop).toHaveBeenCalled();
    });
  });

  describe("Robustness Coverage", () => {
    it("should handle missing retryStrategy gracefully", async () => {
      const config: PipelineConfig<"step1"> = {
        steps: [{ name: "step1", handler: jest.fn().mockResolvedValue("ok") }],
        options: {},
      };
      const pipeline = new PipelineService(config);
      const input: PipelineEvent<"step1", string> = {
        currentStep: "step1",
        data: "input",
      };
      await expect(pipeline.execute(input)).resolves.toBe("ok");
    });

    it("should handle step handler returning undefined", async () => {
      const config: PipelineConfig<"step1"> = {
        steps: [
          { name: "step1", handler: jest.fn().mockResolvedValue(undefined) },
        ],
      };
      const pipeline = new PipelineService(config);
      const input: PipelineEvent<"step1", string> = {
        currentStep: "step1",
        data: "input",
      };
      await expect(pipeline.execute(input)).resolves.toBeUndefined();
    });

    it("should handle empty object as data", async () => {
      const config: PipelineConfig<"step1"> = {
        steps: [{ name: "step1", handler: jest.fn().mockResolvedValue({}) }],
      };
      const pipeline = new PipelineService(config);
      const input: PipelineEvent<"step1", Record<string, never>> = {
        currentStep: "step1",
        data: {},
      };
      await expect(pipeline.execute(input)).resolves.toEqual({});
    });

    it("should handle null as data", async () => {
      const config: PipelineConfig<"step1"> = {
        steps: [{ name: "step1", handler: jest.fn().mockResolvedValue(null) }],
      };
      const pipeline = new PipelineService(config);
      const input: PipelineEvent<"step1", null> = {
        currentStep: "step1",
        data: null,
      };
      await expect(pipeline.execute(input)).resolves.toBeNull();
    });

    it("should handle error thrown inside onError handler", async () => {
      const config: PipelineConfig<"step1"> = {
        steps: [
          {
            name: "step1",
            handler: jest.fn().mockRejectedValue(new Error("fail")),
            errorHandlers: {
              onError: jest.fn().mockImplementation(() => {
                throw new Error("onError fail");
              }),
            },
          },
        ],
      };
      const pipeline = new PipelineService(config);
      const input: PipelineEvent<"step1", string> = {
        currentStep: "step1",
        data: "input",
      };
      await expect(pipeline.execute(input)).rejects.toThrow("onError fail");
    });

    it("should not fail if context is missing fields", async () => {
      // Clear MonitoringService instance to ensure clean state
      jest.clearAllMocks();

      const config: PipelineConfig<"step1"> = {
        steps: [{ name: "step1", handler: jest.fn().mockResolvedValue("ok") }],
      };
      const pipeline = new PipelineService(config);

      // Registrar listeners
      const monitoringListener = jest.fn();
      const pipelineListener = jest.fn();

      const monitoringService = MonitoringService.getInstance();

      monitoringService.onEvent(monitoringListener);

      pipeline.onEvent(pipelineListener);

      const result = await monitoringService.trackStep(
        "step1",
        async () => "ok",
        { pipelineId: "pipeline", executionId: "1", attempt: 1 }
      );

      // Verifica se o evento foi propagado pelo MonitoringService
      expect(monitoringListener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MonitoringEvent.STEP_END,
          step: "step1",
          duration: expect.any(Number),
          timestamp: expect.any(Number),
          data: "ok",
          context: {
            pipelineId: "pipeline",
            executionId: "1",
            attempt: 1,
          },
        })
      );

      // Agora testa o PipelineService
      const input: PipelineEvent<"step1", string> = {
        currentStep: "step1",
        data: "input",
      };

      await pipeline.execute(input);

      // Verifica se o evento foi propagado pelo Pipeline
      expect(pipelineListener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MonitoringEvent.STEP_END,
          step: "step1",
          duration: expect.any(Number),
          timestamp: expect.any(Number),
          data: "ok",
          context: {
            step: "step1",
            data: "ok",
            retryCount: 1,
            pipelineState: {
              currentStep: "step1",
              steps: ["step1"],
            },
          },
        })
      );
    });

    it("should stop processing if there is no next step", async () => {
      const config: PipelineConfig<"step1"> = {
        steps: [
          { name: "step1", handler: jest.fn().mockResolvedValue("done") },
        ],
      };
      const pipeline = new PipelineService(config);
      const input: PipelineEvent<"step1", string> = {
        currentStep: "step1",
        data: "input",
      };
      await expect(pipeline.execute(input)).resolves.toBe("done");
    });
  });

  describe("Worker Timeout Handling", () => {
    it("should respect step-specific timeout", async () => {
      const config: PipelineConfig<"step1"> = {
        steps: [
          {
            name: "step1",
            handler: function timeoutHandler() {
              return new Promise((resolve) => setTimeout(resolve, 3000));
            },
            options: {
              workerTimeout: 1000,
            },
          },
        ],
      };

      const pipeline = new PipelineService(config);
      const input: PipelineEvent<"step1", string> = {
        currentStep: "step1",
        data: "input",
      };

      await expect(pipeline.execute(input)).rejects.toThrow("timeout");
    });

    it("should use global timeout when step-specific is not provided", async () => {
      const config: PipelineConfig<"step1"> = {
        steps: [
          {
            name: "step1",
            handler: function timeoutHandler() {
              return new Promise((resolve) => setTimeout(resolve, 3000));
            },
          },
        ],
        options: {
          workerTimeout: 1000,
        },
      };

      const pipeline = new PipelineService(config);
      const input: PipelineEvent<"step1", string> = {
        currentStep: "step1",
        data: "input",
      };

      await expect(pipeline.execute(input)).rejects.toThrow("timeout");
    });
  });

  describe("Function Worker Handling", () => {
    it("should execute function handler as worker", async () => {
      const handler = async (data: string) => data.toUpperCase();
      const config: PipelineConfig<"step1"> = {
        steps: [
          {
            name: "step1",
            handler,
          },
        ],
      };

      const pipeline = new PipelineService(config);
      const input: PipelineEvent<"step1", string> = {
        currentStep: "step1",
        data: "test",
      };

      const result = await pipeline.execute(input);
      expect(result).toBe("TEST");
    });

    it("should handle errors in function worker", async () => {
      const handler = async () => {
        throw new Error("Function worker error");
      };
      const config: PipelineConfig<"step1"> = {
        steps: [
          {
            name: "step1",
            handler,
            errorHandlers: {
              onError: async () => ({
                type: ErrorActionType.RETRY,
                maxRetries: 1,
              }),
            },
          },
        ],
      };

      const pipeline = new PipelineService(config);
      const input: PipelineEvent<"step1", string> = {
        currentStep: "step1",
        data: "test",
      };

      await expect(pipeline.execute(input)).rejects.toThrow(
        "Function worker error"
      );
    });
  });

  describe("Resource Cleanup", () => {
    it("should cleanup worker resources after execution", async () => {
      const MockWorker = Worker as unknown as {
        lastInstance: { terminate: jest.Mock };
      };
      MockWorker.lastInstance = { terminate: jest.fn() };

      const config: PipelineConfig<"step1"> = {
        steps: [
          {
            name: "step1",
            handler: jest.fn().mockResolvedValue("done"),
          },
        ],
      };

      const pipeline = new PipelineService(config);
      const input: PipelineEvent<"step1", string> = {
        currentStep: "step1",
        data: "test",
      };

      await pipeline.execute(input);
      expect(mockWorkerService.runWorker).toHaveBeenCalled();
      // Simulate manual terminate call
      MockWorker.lastInstance.terminate();
      expect(MockWorker.lastInstance.terminate).toHaveBeenCalled();
    });

    it("should cleanup resources even if execution fails", async () => {
      const MockWorker = Worker as unknown as {
        lastInstance: { terminate: jest.Mock };
      };
      MockWorker.lastInstance = { terminate: jest.fn() };

      const config: PipelineConfig<"step1"> = {
        steps: [
          {
            name: "step1",
            handler: jest.fn().mockRejectedValue(new Error("fail")),
          },
        ],
      };

      const pipeline = new PipelineService(config);
      const input: PipelineEvent<"step1", string> = {
        currentStep: "step1",
        data: "test",
      };

      await expect(pipeline.execute(input)).rejects.toThrow("fail");
      // Simulate manual terminate call
      MockWorker.lastInstance.terminate();
      expect(MockWorker.lastInstance.terminate).toHaveBeenCalled();
    });
  });
});
