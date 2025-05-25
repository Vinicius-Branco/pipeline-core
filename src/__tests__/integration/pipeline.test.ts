import { setupTestPipeline } from "./setup";
import { ErrorActionType, EVENT_TYPES } from "../../types";

describe("Pipeline Integration Tests", () => {
  let pipeline: ReturnType<typeof setupTestPipeline>;

  afterEach(async () => {
    if (pipeline) {
      await pipeline.cleanup?.();
    }
  });

  describe("Basic Execution", () => {
    beforeEach(() => {
      pipeline = setupTestPipeline([
        {
          name: "step1",
          handler: async (data: { value: number }) => ({
            ...data,
            value: data.value + 1,
          }),
        },
        {
          name: "step2",
          handler: async (data: { value: number }) => ({
            ...data,
            value: data.value * 2,
          }),
        },
      ]);
    });
    it("should execute a step and continue the flow", async () => {
      const result = await pipeline.execute({
        data: { value: 1 },
        currentStep: "step1",
      });
      // step1: 1 + 1 = 2, step2: 2 * 2 = 4
      expect(result.value).toBe(4);
    });
    it("should execute starting from step2", async () => {
      const result = await pipeline.execute({
        data: { value: 2 },
        currentStep: "step2",
      });
      // step2: 2 * 2 = 4
      expect(result.value).toBe(4);
    });
  });

  describe("Parallel Processing", () => {
    beforeEach(() => {
      pipeline = setupTestPipeline([
        {
          name: "step1",
          handler: async (data: { value: number }) => ({
            ...data,
            value: data.value + 1,
          }),
        },
        {
          name: "step2",
          handler: async (data: { value: number }) => ({
            ...data,
            value: data.value * 2,
          }),
        },
      ]);
    });
    it("should process multiple items in parallel", async () => {
      const items = [
        { data: { value: 1 }, currentStep: "step1" },
        { data: { value: 2 }, currentStep: "step1" },
        { data: { value: 3 }, currentStep: "step1" },
      ];
      const results = await pipeline.execute(items);
      expect(results).toHaveLength(3);
      // Each item goes through step1 (+1) and step2 (*2)
      expect(results[0].value).toBe(4); // (1 + 1) * 2
      expect(results[1].value).toBe(6); // (2 + 1) * 2
      expect(results[2].value).toBe(8); // (3 + 1) * 2
    });
  });

  describe("Error Handling", () => {
    beforeEach(() => {
      pipeline = setupTestPipeline([
        {
          name: "errorStep",
          handler: async () => {
            throw new Error("Simulated error");
          },
          errorHandlers: {
            onError: async () => ({
              type: ErrorActionType.RETRY,
              maxRetries: 1,
            }),
          },
        },
      ]);
    });
    it("should handle errors and perform retry", async () => {
      const errorEvents: any[] = [];
      pipeline.onEvent((event) => {
        if (event.type === EVENT_TYPES.ERROR) {
          errorEvents.push(event);
        }
      });
      await expect(
        pipeline.execute({
          data: { value: 1 },
          currentStep: "errorStep",
        })
      ).rejects.toThrow("Simulated error");
      expect(errorEvents.length).toBeGreaterThan(0);
    }, 15000);
    it("should stop execution after exceeding the maximum number of retries", async () => {
      const errorEvents: any[] = [];
      pipeline.onEvent((event) => {
        if (event.type === EVENT_TYPES.ERROR) {
          errorEvents.push(event);
        }
      });
      await expect(
        pipeline.execute({
          data: { value: 1 },
          currentStep: "errorStep",
        })
      ).rejects.toThrow("Simulated error");
      expect(errorEvents.length).toBeLessThanOrEqual(2);
    }, 15000);
  });

  describe("Timeout and Concurrency", () => {
    it("should respect the worker timeout", async () => {
      const pipeline = setupTestPipeline([
        {
          name: "slowStep",
          handler: async (data: { value: number }) => {
            await new Promise((resolve) => setTimeout(resolve, 3000));
            return { ...data, value: data.value + 1 };
          },
          options: {
            workerTimeout: 2000,
            retryStrategy: { maxRetries: 0 },
          },
        },
      ]);

      const timeoutEvents: any[] = [];
      pipeline.onEvent((event) => {
        if (
          event.type === EVENT_TYPES.ERROR &&
          event.error?.message.includes("timeout")
        ) {
          timeoutEvents.push(event);
        }
      });

      // Run the pipeline and expect it to fail with a timeout
      await expect(
        pipeline.execute({
          data: { value: 1 },
          currentStep: "slowStep",
        })
      ).rejects.toThrow("timeout");

      // Check if the timeout event was emitted
      expect(timeoutEvents.length).toBe(1);
      expect(timeoutEvents[0].error.message).toContain("timeout");
    }, 10000);
    it("should respect the limit of concurrent workers", async () => {
      const pipeline = setupTestPipeline(
        [
          {
            name: "step1",
            handler: async (data: { value: number }) => {
              await new Promise((resolve) => setTimeout(resolve, 1000));
              return { ...data, value: data.value + 1 };
            },
          },
        ],
        { maxConcurrentWorkers: 2 }
      );
      const startTime = Date.now();
      const items = Array.from({ length: 5 }, (_, i) => ({
        data: { value: i },
        currentStep: "step1",
      }));
      const results = await pipeline.execute(items);
      const endTime = Date.now();
      const executionTime = endTime - startTime;
      expect(results).toHaveLength(5);
      results.forEach((result, index) => {
        expect(result.value).toBe(index + 1);
      });
      expect(executionTime).toBeGreaterThan(2000);
    }, 15000);
  });
});
