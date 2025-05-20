import { PipelineService } from "./pipeline";
import { PipelineConfig, PipelineEvent, ErrorActionType } from "../types";
import { Worker } from "worker_threads";

// Mock Worker
jest.mock("worker_threads", () => ({
  Worker: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    removeListener: jest.fn(),
    terminate: jest.fn(),
    postMessage: jest.fn(),
  })),
}));

describe("PipelineService", () => {
  let pipelineService: PipelineService<"step1" | "step2" | "step3">;
  let mockConfig: PipelineConfig<"step1" | "step2" | "step3">;

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
        },
      },
    };

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
  });

  describe("Parallel Execution", () => {
    it("should handle parallel execution of multiple items", async () => {
      const inputs: PipelineEvent<"step1", any>[] = [
        { currentStep: "step1", data: { id: 1 } },
        { currentStep: "step1", data: { id: 2 } },
        { currentStep: "step1", data: { id: 3 } },
      ];

      const results = await pipelineService.execute(inputs);

      expect(results).toHaveLength(3);
      expect(results[0]).toEqual({
        id: 1,
        step1: true,
        step2: true,
        step3: true,
      });
      expect(results[1]).toEqual({
        id: 2,
        step1: true,
        step2: true,
        step3: true,
      });
      expect(results[2]).toEqual({
        id: 3,
        step1: true,
        step2: true,
        step3: true,
      });
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
        })
      );
    });
  });

  describe("Worker Threads", () => {
    it("should handle worker thread handlers", async () => {
      const workerConfig: PipelineConfig<"step1"> = {
        steps: [
          {
            name: "step1",
            handler: "path/to/worker.js",
          },
        ],
      };

      // Cria a instância mockada do Worker antes de executar o pipeline
      const mockWorkerInstance = {
        on: jest.fn(),
        removeListener: jest.fn(),
        terminate: jest.fn(),
        postMessage: jest.fn(),
      };
      const mockWorker = Worker as unknown as jest.Mock;
      mockWorker.mockClear();
      mockWorker.mockReturnValue(mockWorkerInstance);

      let messageCallback: any;
      mockWorkerInstance.on.mockImplementation((event: any, callback: any) => {
        if (event === "message") {
          messageCallback = callback;
        }
      });
      mockWorkerInstance.postMessage.mockImplementation(() => {
        if (messageCallback) {
          messageCallback({ initial: true, step1: true });
        }
      });

      const service = new PipelineService(workerConfig);
      const input: PipelineEvent<"step1", any> = {
        currentStep: "step1",
        data: { initial: true },
      };

      const result = await service.execute(input);

      expect(result).toEqual({
        initial: true,
        step1: true,
      });
      expect(mockWorkerInstance.terminate).toHaveBeenCalled();
    });
  });
});
