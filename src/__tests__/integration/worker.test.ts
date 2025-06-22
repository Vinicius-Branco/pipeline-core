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

  describe("Graceful Terminate", () => {
    beforeEach(() => {
      workerService = new WorkerService({
        maxConcurrentWorkers: 3,
      });
    });

    it("should terminate immediately when no active workers", async () => {
      const startTime = Date.now();
      await workerService.gracefulTerminate(5000);
      const endTime = Date.now();

      // Should terminate quickly when there are no active workers
      expect(endTime - startTime).toBeLessThan(100);
      expect(workerService.getActiveWorkersCount()).toBe(0);
    });

    it("should wait for active workers to complete within timeout", async () => {
      const longRunningHandler = async (data: { delay: number }) => {
        await new Promise((resolve) => setTimeout(resolve, data.delay));
        return { completed: true };
      };

      // Start workers that take 200ms each
      const workerPromises = Array.from({ length: 2 }, (_, index) =>
        workerService.runWorker(longRunningHandler, { delay: 200 })
      );

      // Wait a bit to ensure workers are running
      await new Promise((resolve) => setTimeout(resolve, 50));

      const startTime = Date.now();
      await workerService.gracefulTerminate(1000); // 1 second timeout
      const endTime = Date.now();

      // Should wait for workers to finish (200ms) but not exceed timeout (1000ms)
      expect(endTime - startTime).toBeGreaterThanOrEqual(200);
      expect(endTime - startTime).toBeLessThan(1000);
      expect(workerService.getActiveWorkersCount()).toBe(0);

      // Wait for workers to finish
      await Promise.all(workerPromises);
    });

    it("should force abort workers when timeout is exceeded", async () => {
      const infiniteHandler = async () => {
        // Worker that never finishes
        await new Promise(() => {}); // Promise that never resolves
        return { completed: true };
      };

      // Start infinite workers
      const workerPromises = Array.from({ length: 2 }, (_, index) =>
        workerService.runWorker(infiniteHandler, {})
      );

      // Wait a bit to ensure workers are running
      await new Promise((resolve) => setTimeout(resolve, 50));

      const startTime = Date.now();
      await workerService.gracefulTerminate(100); // Short timeout of 100ms
      const endTime = Date.now();

      // Should terminate after timeout (100ms) but not take much longer
      expect(endTime - startTime).toBeGreaterThanOrEqual(100);
      expect(endTime - startTime).toBeLessThan(300);
      expect(workerService.getActiveWorkersCount()).toBe(0);

      // Workers should have been aborted
      await expect(Promise.all(workerPromises)).rejects.toThrow();
    });

    it("should handle mixed scenarios with some workers completing and others timing out", async () => {
      const fastHandler = async (data: { delay: number }) => {
        await new Promise((resolve) => setTimeout(resolve, data.delay));
        return { completed: true };
      };

      const infiniteHandler = async () => {
        await new Promise(() => {}); // Promise that never resolves
        return { completed: true };
      };

      // Start mixed workers: some fast, others infinite
      const fastWorkerPromises = Array.from({ length: 2 }, (_, index) =>
        workerService.runWorker(fastHandler, { delay: 50 })
      );

      const infiniteWorkerPromises = Array.from({ length: 2 }, (_, index) =>
        workerService.runWorker(infiniteHandler, {})
      );

      // Wait a bit to ensure workers are running
      await new Promise((resolve) => setTimeout(resolve, 25));

      const startTime = Date.now();
      await workerService.gracefulTerminate(200); // 200ms timeout
      const endTime = Date.now();

      // Should wait for fast workers to finish (50ms) but abort infinite ones
      expect(endTime - startTime).toBeGreaterThanOrEqual(50);
      expect(endTime - startTime).toBeLessThan(300);
      expect(workerService.getActiveWorkersCount()).toBe(0);

      // Fast workers should have finished successfully
      await expect(Promise.all(fastWorkerPromises)).resolves.toBeDefined();

      // Infinite workers should have been aborted
      await expect(Promise.all(infiniteWorkerPromises)).rejects.toThrow();
    });

    it("should work correctly with step-specific workers", async () => {
      const stepHandler = async (data: { delay: number }) => {
        await new Promise((resolve) => setTimeout(resolve, data.delay));
        return { completed: true };
      };

      // Start workers in different steps
      const step1Promises = Array.from({ length: 2 }, (_, index) =>
        workerService.runWorker(stepHandler, { delay: 100 }, undefined, "step1")
      );

      const step2Promises = Array.from({ length: 2 }, (_, index) =>
        workerService.runWorker(stepHandler, { delay: 150 }, undefined, "step2")
      );

      // Wait a bit to ensure workers are running
      await new Promise((resolve) => setTimeout(resolve, 25));

      const startTime = Date.now();
      await workerService.gracefulTerminate(300); // 300ms timeout
      const endTime = Date.now();

      // Should wait for all workers to finish
      expect(endTime - startTime).toBeGreaterThanOrEqual(150);
      expect(endTime - startTime).toBeLessThan(400);
      expect(workerService.getActiveWorkersCount()).toBe(0);
      expect(workerService.getActiveWorkersCount("step1")).toBe(0);
      expect(workerService.getActiveWorkersCount("step2")).toBe(0);

      // All workers should have finished successfully
      await expect(
        Promise.all([...step1Promises, ...step2Promises])
      ).resolves.toBeDefined();
    });

    it("should handle gracefulTerminate being called multiple times", async () => {
      const handler = async (data: { delay: number }) => {
        await new Promise((resolve) => setTimeout(resolve, data.delay));
        return { completed: true };
      };

      // Start some workers
      const workerPromises = Array.from({ length: 2 }, (_, index) =>
        workerService.runWorker(handler, { delay: 100 })
      );

      // Wait a bit to ensure workers are running
      await new Promise((resolve) => setTimeout(resolve, 25));

      // Call gracefulTerminate multiple times
      const terminatePromises = [
        workerService.gracefulTerminate(500),
        workerService.gracefulTerminate(500),
        workerService.gracefulTerminate(500),
      ];

      await Promise.all(terminatePromises);

      expect(workerService.getActiveWorkersCount()).toBe(0);
      await expect(Promise.all(workerPromises)).resolves.toBeDefined();
    });
  });
});
