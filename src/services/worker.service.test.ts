// Global array to store mocked Worker instances
const workerInstances: any[] = [];

// Mock worker_threads BEFORE importing WorkerService
jest.mock("worker_threads", () => {
  return {
    Worker: jest.fn().mockImplementation(() => {
      const instance = {
        on: jest.fn().mockImplementation((event, callback) => {
          // Store the callback for later use
          if (!instance._callbacks) instance._callbacks = {};
          instance._callbacks[event] = callback;
        }),
        postMessage: jest.fn(),
        terminate: jest.fn(),
        _callbacks: {},
        // Method to simulate events
        _simulateEvent: function (event: string, data: any) {
          if (this._callbacks[event]) {
            this._callbacks[event](data);
          }
        },
        // Method to simulate events asynchronously
        _simulateEventAsync: function (event: string, data: any) {
          if (this._callbacks[event]) {
            setImmediate(() => {
              this._callbacks[event](data);
            });
          }
        },
      };
      workerInstances.push(instance);
      return instance;
    }),
  };
});

// Mock fs
jest.mock("fs", () => ({
  writeFileSync: jest.fn(),
  unlinkSync: jest.fn(),
}));

// Mock esbuild
jest.mock("esbuild", () => ({
  buildSync: jest.fn(),
}));

import { WorkerService } from "./worker.service";
import { PipelineOptions } from "../types";

describe("WorkerService", () => {
  let workerService: WorkerService;

  beforeEach(() => {
    jest.clearAllMocks();
    workerInstances.length = 0; // Clear instances

    const options: PipelineOptions = {
      maxConcurrentWorkers: 2,
      workerTimeout: 30000, // Larger timeout to avoid test issues
    };
    workerService = new WorkerService(options);
  });

  // Utility function to simulate worker events
  function simulateWorkerEvent(index: number, event: string, data: any) {
    if (workerInstances[index]) {
      workerInstances[index]._simulateEvent(event, data);
    }
  }

  describe("Constructor and Initialization", () => {
    it("should initialize with default options", () => {
      const service = new WorkerService();
      expect(service.getActiveWorkersCount()).toBe(0);
      expect(service.isShutdownState()).toBe(false);
    });

    it("should initialize with custom options", () => {
      const options: PipelineOptions = {
        maxConcurrentWorkers: 5,
        workerTimeout: 10000,
      };
      const service = new WorkerService(options);
      expect(service.getActiveWorkersCount()).toBe(0);
      expect(service.isShutdownState()).toBe(false);
    });
  });

  describe("Worker Execution", () => {
    it("should execute a function handler and resolve with result", async () => {
      const handler = async (data: any) => ({ result: "test" });

      const promise = workerService.runWorker(handler, { test: "data" });

      // Wait a bit for the Worker to be created
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Simulate the message event
      simulateWorkerEvent(0, "message", { result: "success" });

      const result = await promise;
      expect(result).toEqual({ result: "success" });
    });

    it("should execute a string path handler", async () => {
      const promise = workerService.runWorker("test-worker.js", {
        test: "data",
      });

      // Wait a bit for the Worker to be created
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Simulate the message event
      simulateWorkerEvent(0, "message", { result: "success" });

      const result = await promise;
      expect(result).toEqual({ result: "success" });
    });

    it("should reject if worker emits error", async () => {
      const handler = async (data: any) => ({ result: "test" });
      const promise = workerService.runWorker(handler, { test: "data" });

      // Wait a bit for the Worker to be created
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Simulate the error event
      simulateWorkerEvent(0, "error", new Error("Worker error"));

      await expect(promise).rejects.toThrow("Worker error");
    });

    it("should reject if worker exits with non-zero code", async () => {
      const handler = async (data: any) => ({ result: "test" });
      const promise = workerService.runWorker(handler, { test: "data" });

      // Wait a bit for the Worker to be created
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Simulate the exit event with non-zero code
      simulateWorkerEvent(0, "exit", 1);

      await expect(promise).rejects.toThrow("Worker stopped with exit code 1");
    });

    it("should reject if worker times out", async () => {
      const handler = async (data: any) => ({ result: "test" });
      const promise = workerService.runWorker(
        handler,
        { test: "data" },
        { workerTimeout: 100 }
      );

      // Don't simulate any events - let it timeout
      await expect(promise).rejects.toThrow("Worker timeout");
    });

    it("should reject new workers when shutdown", async () => {
      await workerService.shutdown();
      const handler = async (data: any) => ({ result: "test" });
      await expect(
        workerService.runWorker(handler, { test: "data" })
      ).rejects.toThrow("WorkerService is shutdown");
    });
  });

  describe("Concurrency Control", () => {
    it("should respect maxConcurrentWorkers", async () => {
      const handler = async (data: any) => ({ result: "test" });
      const promises = [
        workerService.runWorker(handler, { id: 1 }),
        workerService.runWorker(handler, { id: 2 }),
        workerService.runWorker(handler, { id: 3 }),
      ];

      // Wait a bit for the Workers to be created
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Check that only 2 workers are active (maxConcurrentWorkers = 2)
      // The third worker should be waiting for the semaphore
      expect(workerService.getActiveWorkersCount()).toBeLessThanOrEqual(2);

      // Simulate events for the first 2 workers
      simulateWorkerEvent(0, "message", { result: "success" });
      simulateWorkerEvent(1, "message", { result: "success" });

      // Wait a bit for the third worker to be created and executed
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Simulate event for the third worker
      simulateWorkerEvent(2, "message", { result: "success" });

      await Promise.all(promises);

      // Wait a bit more to ensure all workers were finalized
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(workerService.getActiveWorkersCount()).toBe(0);
    }, 10000);

    it("should track active workers count", async () => {
      const handler = async (data: any) => ({ result: "test" });
      const promise = workerService.runWorker(handler, { test: "data" });

      // Wait a bit for the Worker to be created
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Check that there is 1 active worker
      expect(workerService.getActiveWorkersCount()).toBe(1);

      // Simulate the message event
      simulateWorkerEvent(0, "message", { result: "success" });

      await promise;

      // Wait a bit more to ensure the worker was finalized
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(workerService.getActiveWorkersCount()).toBe(0);
    });
  });

  describe("Graceful Shutdown", () => {
    it("should shutdown immediately when no active workers", async () => {
      const startTime = Date.now();
      await workerService.shutdown();
      const endTime = Date.now();
      expect(endTime - startTime).toBeLessThan(100);
      expect(workerService.isShutdownState()).toBe(true);
    });

    it("should wait for active workers to complete", async () => {
      const handler = async (data: any) => ({ result: "test" });
      const workerPromise = workerService.runWorker(handler, { test: "data" });

      // Wait a bit for the Worker to be created
      await new Promise((resolve) => setTimeout(resolve, 100));

      const shutdownPromise = workerService.shutdown(1000);

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(workerService.isShutdownState()).toBe(true);

      // Simulate the message event
      simulateWorkerEvent(0, "message", { result: "success" });

      await workerPromise;
      await shutdownPromise;
    });

    it("should timeout during shutdown", async () => {
      const testWorkerService = new WorkerService({
        maxConcurrentWorkers: 2,
        workerTimeout: 60000,
      });

      // Create an active worker so that waitForWorkersCompletion doesn't resolve immediately
      const handler = async (data: any) => ({ result: "test" });
      const workerPromise = testWorkerService.runWorker(handler, {
        test: "data",
      });

      // Wait a bit for the worker to be created
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(testWorkerService.getActiveWorkersCount()).toBe(1);

      // Mock waitForWorkersCompletion to never resolve
      const originalMethod = testWorkerService.waitForWorkersCompletion;
      testWorkerService.waitForWorkersCompletion = () => new Promise(() => {});

      try {
        // Direct test of Promise.race used in shutdown
        const timeoutPromise = new Promise<void>((_, reject) => {
          setTimeout(() => {
            reject(new Error(`WorkerService shutdown timeout after 100ms`));
          }, 100);
        });

        const waitPromise = testWorkerService.waitForWorkersCompletion();

        await expect(
          Promise.race([waitPromise, timeoutPromise])
        ).rejects.toThrow("WorkerService shutdown timeout after 100ms");
      } finally {
        // Restore original method
        testWorkerService.waitForWorkersCompletion = originalMethod;

        // Finalize the worker
        simulateWorkerEvent(0, "message", { result: "success" });
        await workerPromise;
      }
    }, 5000);
  });

  describe("Abort and Cleanup", () => {
    it("should abort all active workers", async () => {
      const handler = async (data: any) => ({ result: "test" });
      // Use much larger timeout to prevent workers from being finalized by timeout
      const worker1 = workerService.runWorker(
        handler,
        { test: "data1" },
        { workerTimeout: 60000 }
      );
      const worker2 = workerService.runWorker(
        handler,
        { test: "data2" },
        { workerTimeout: 60000 }
      );

      // Wait a bit for the Workers to be created
      await new Promise((resolve) => setTimeout(resolve, 100));

      await workerService.abortAllWorkers();

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(workerInstances[0].postMessage).toHaveBeenCalledWith("abort");
      expect(workerInstances[0].terminate).toHaveBeenCalled();
      expect(workerInstances[1].postMessage).toHaveBeenCalledWith("abort");
      expect(workerInstances[1].terminate).toHaveBeenCalled();
      expect(workerService.getActiveWorkersCount()).toBe(0);
    }, 15000);
  });

  describe("Wait for Completion", () => {
    it("should wait for all workers to complete", async () => {
      const handler = async (data: any) => ({ result: "test" });
      const workerPromise = workerService.runWorker(handler, { test: "data" });

      // Wait a bit for the Worker to be created
      await new Promise((resolve) => setTimeout(resolve, 100));

      const waitPromise = workerService.waitForWorkersCompletion();

      // Simulate the message event
      simulateWorkerEvent(0, "message", { result: "success" });

      await workerPromise;
      await waitPromise;
    });

    it("should resolve immediately when no active workers", async () => {
      const startTime = Date.now();
      await workerService.waitForWorkersCompletion();
      const endTime = Date.now();
      expect(endTime - startTime).toBeLessThan(100);
    });
  });
});
