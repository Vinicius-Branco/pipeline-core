import { WorkerService } from "../../services/worker.service";
import { PipelineOptions, StepOptions } from "../../types";

describe("Worker Service Integration Tests", () => {
  let workerService: WorkerService;

  afterEach(async () => {
    await workerService.cleanup();
  });

  describe("Basic Worker Operations", () => {
    beforeEach(() => {
      workerService = new WorkerService();
    });

    it("should execute a simple worker function", async () => {
      const handler = async (data: { value: number }) => {
        return { result: data.value * 2 };
      };

      const result = await workerService.runWorker(handler, { value: 5 });
      expect(result).toEqual({ result: 10 });
    });

    it("should handle TypeScript code correctly", async () => {
      const handler = async (data: {
        value: number;
      }): Promise<{ result: number }> => {
        const doubled: number = data.value * 2;
        return { result: doubled };
      };

      const result = await workerService.runWorker(handler, { value: 5 });
      expect(result).toEqual({ result: 10 });
    });

    it("should respect worker timeout", async () => {
      const options: PipelineOptions = {
        workerTimeout: 100,
      };

      const handler = async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return { result: "done" };
      };

      await expect(
        workerService.runWorker(handler, {}, options)
      ).rejects.toThrow("Worker timeout");
    });
  });

  describe("Concurrency Control", () => {
    beforeEach(() => {
      workerService = new WorkerService({
        maxConcurrentWorkers: 2,
      });
    });

    it("should respect global concurrency limit", async () => {
      const delays = [100, 50, 150, 75];

      const tasks = delays.map((delay, index) => {
        const handler = async (data: { index: number; delay: number }) => {
          await new Promise((resolve) => setTimeout(resolve, data.delay));
          return { index: data.index };
        };
        return workerService.runWorker(handler, { index, delay });
      });

      const results = await Promise.all(tasks);
      const sortedResults = results.sort((a, b) => a.index - b.index);
      expect(sortedResults).toHaveLength(4);
      expect(workerService.getActiveWorkersCount()).toBe(0);
    });

    it("should respect step-specific concurrency limit", async () => {
      const stepOptions: StepOptions = {
        maxConcurrentWorkers: 1,
      };

      const delays = [100, 50, 150];

      const tasks = delays.map((delay, index) => {
        const handler = async (data: { index: number; delay: number }) => {
          await new Promise((resolve) => setTimeout(resolve, data.delay));
          return { index: data.index };
        };
        return workerService.runWorker(
          handler,
          { index, delay },
          undefined,
          "testStep",
          stepOptions
        );
      });

      const results = await Promise.all(tasks);
      const sortedResults = results.sort((a, b) => a.index - b.index);
      expect(sortedResults).toHaveLength(3);
      expect(workerService.getActiveWorkersCount("testStep")).toBe(0);
    });
  });

  describe("Error Handling", () => {
    beforeEach(() => {
      workerService = new WorkerService();
    });

    it("should handle worker errors correctly", async () => {
      const handler = async () => {
        return { error: "Worker error" };
      };

      await expect(workerService.runWorker(handler, {})).rejects.toThrow(
        "Worker error"
      );
    });

    it("should handle worker crashes", async () => {
      const handler = async () => {
        process.exit(1);
      };

      await expect(workerService.runWorker(handler, {})).rejects.toThrow(
        "Worker stopped with exit code 1"
      );
    });

    it("should handle worker timeouts", async () => {
      const handler = async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return { result: "done" };
      };

      await expect(
        workerService.runWorker(handler, {}, { workerTimeout: 100 })
      ).rejects.toThrow("Worker timeout");
    });
  });

  describe("Resource Cleanup", () => {
    beforeEach(() => {
      workerService = new WorkerService();
    });

    it("should cleanup resources after execution", async () => {
      const handler = async () => ({ result: "done" });
      await workerService.runWorker(handler, {});
      await workerService.cleanup();

      expect(workerService.getActiveWorkersCount()).toBe(0);
    });

    it("should handle cleanup of multiple workers", async () => {
      const tasks = Array.from({ length: 5 }, (_, index) => {
        const handler = async (data: { index: number }) => ({
          index: data.index,
        });
        return workerService.runWorker(handler, { index });
      });

      const results = await Promise.all(tasks);
      expect(results).toHaveLength(5);
      await workerService.cleanup();

      expect(workerService.getActiveWorkersCount()).toBe(0);
    });
  });

  describe("Complex Scenarios", () => {
    beforeEach(() => {
      workerService = new WorkerService({
        maxConcurrentWorkers: 3,
        retryStrategy: {
          maxRetries: 1,
          backoffMs: 50,
        },
      });
    });

    it("should handle multiple steps with different concurrency limits", async () => {
      const step1Options: StepOptions = { maxConcurrentWorkers: 1 };
      const step2Options: StepOptions = { maxConcurrentWorkers: 2 };

      const step1Handler = async (data: { value: number }) => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { value: data.value + 1 };
      };

      const step2Handler = async (data: { value: number }) => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { value: data.value * 2 };
      };

      const tasks = Array.from({ length: 4 }, (_, i) => {
        return Promise.all([
          workerService.runWorker(
            step1Handler,
            { value: i },
            undefined,
            "step1",
            step1Options
          ),
          workerService.runWorker(
            step2Handler,
            { value: i },
            undefined,
            "step2",
            step2Options
          ),
        ]);
      });

      const results = await Promise.all(tasks);
      expect(results).toHaveLength(4);
      expect(workerService.getActiveWorkersCount("step1")).toBe(0);
      expect(workerService.getActiveWorkersCount("step2")).toBe(0);
    });

    it("should handle mixed success and failure scenarios", async () => {
      const successHandler = async (data: { value: number }) => {
        return { value: data.value * 2 };
      };

      const failureHandler = async () => {
        return { error: "Simulated failure" };
      };

      const tasks = [
        workerService.runWorker(successHandler, { value: 1 }),
        workerService.runWorker(failureHandler, {}),
        workerService.runWorker(successHandler, { value: 2 }),
      ];

      const results = await Promise.allSettled(tasks);
      expect(results[0].status).toBe("fulfilled");
      expect(results[1].status).toBe("rejected");
      expect(results[2].status).toBe("fulfilled");
    });
  });
});
