import { Worker } from "worker_threads";
import { WorkerService } from "./worker.service";
import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import esbuild from "esbuild";

// Mock Worker
jest.mock("worker_threads", () => {
  const instances: any[] = [];
  const eventsMap = new WeakMap();
  class MockWorker {
    on: jest.Mock;
    terminate: jest.Mock;
    postMessage: jest.Mock;
    private isTerminated = false;

    constructor(_path: string, _opts: unknown) {
      const events: Record<string, Array<(...args: unknown[]) => void>> = {};
      this.on = jest.fn((event, cb) => {
        events[event] = events[event] || [];
        events[event].push(cb);
      });
      this.terminate = jest.fn(() => {
        this.isTerminated = true;
        this.emit("exit", 0);
      });
      this.postMessage = jest.fn();
      instances.push(this);
      eventsMap.set(this, events);
    }

    emit(event: string, data: unknown) {
      if (!this.isTerminated) {
        const events = eventsMap.get(this) || {};
        const callbacks = events[event] || [];
        callbacks.forEach((cb) => {
          try {
            cb(data);
          } catch (error) {
            // Ignore errors in callbacks
          }
        });

        // Finaliza o worker em caso de sucesso ou erro
        if (event === "message" && !("error" in (data as any))) {
          this.terminate();
        } else if (event === "error") {
          this.terminate();
        }
      }
    }

    static get lastInstance() {
      return instances[instances.length - 1];
    }

    static reset() {
      instances.length = 0;
    }

    static get instances() {
      return instances;
    }
  }
  return { Worker: MockWorker };
});

// Mock fs
jest.mock("fs", () => ({
  writeFileSync: jest.fn(),
  unlinkSync: jest.fn(),
}));

// Mock esbuild
jest.mock("esbuild", () => ({
  buildSync: jest.fn().mockImplementation((options) => {
    const { stdin } = options;
    return {
      errors: [],
      warnings: [],
      outputFiles: [
        {
          text: stdin.contents,
          path: "mock-output.js",
        },
      ],
    };
  }),
}));

function waitForWorkerInstance(timeout = 200): Promise<any> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    function check() {
      const worker = (Worker as any).lastInstance;
      if (worker) return resolve(worker);
      if (Date.now() - start > timeout)
        return reject(new Error("Worker instance not created in time"));
      setImmediate(check);
    }
    check();
  });
}

describe("WorkerService", () => {
  let workerService: WorkerService;
  let workerPath: string;

  beforeEach(() => {
    workerService = new WorkerService();
    workerPath = join(__dirname, "test-worker.js");
    (writeFileSync as jest.Mock).mockClear();
    (unlinkSync as jest.Mock).mockClear();
    (Worker as any).reset();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("Worker Execution", () => {
    it("should execute a worker and resolve with result", async () => {
      const promise = workerService.runWorker(workerPath, { id: 1 });
      const worker = await waitForWorkerInstance();
      worker.emit("message", { result: 42 });
      await expect(promise).resolves.toEqual({ result: 42 });
    }, 1000);

    it("should reject if worker times out", async () => {
      const promise = workerService.runWorker(
        workerPath,
        { id: 1 },
        { workerTimeout: 100 }
      );
      await expect(promise).rejects.toThrow("Worker timeout");
    }, 1000);

    it("should reject if worker emits error", async () => {
      const promise = workerService.runWorker(workerPath, { id: 1 });
      const worker = await waitForWorkerInstance();
      worker.emit("error", new Error("fail!"));
      await expect(promise).rejects.toThrow("fail!");
    }, 1000);

    it("should reject if worker exits with non-zero code", async () => {
      const promise = workerService.runWorker(workerPath, { id: 1 });
      const worker = await waitForWorkerInstance();
      worker.emit("exit", 1);
      await expect(promise).rejects.toThrow("Worker stopped with exit code 1");
    }, 1000);

    it("should use step-specific options when provided", async () => {
      const promise = workerService.runWorker(
        workerPath,
        { id: 1 },
        { workerTimeout: 1000 }
      );
      const worker = await waitForWorkerInstance();
      worker.emit("message", { result: 42 });
      await expect(promise).resolves.toEqual({ result: 42 });
    }, 1000);
  });

  describe("Concurrency Control", () => {
    it("should respect maxConcurrentWorkers and queue jobs", async () => {
      const workerService = new WorkerService({ maxConcurrentWorkers: 2 });

      // Inicia 3 workers
      const promises = [
        workerService.runWorker(workerPath, { id: 1 }),
        workerService.runWorker(workerPath, { id: 2 }),
        workerService.runWorker(workerPath, { id: 3 }),
      ];

      // Wait a bit to ensure workers are started
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(workerService.getCurrentConcurrency()).toBeLessThanOrEqual(2);

      // Resolve workers in sequence
      const workers = (Worker as any).instances;
      for (let i = 0; i < workers.length; i++) {
        workers[i].emit("message", { done: i + 1 });
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      // Aguarda todas as promessas serem resolvidas
      await Promise.all(promises);
      expect(workerService.getCurrentConcurrency()).toBe(0);
    }, 3000);

    it("should track active workers count using semaphore", async () => {
      const workerService = new WorkerService({ maxConcurrentWorkers: 1 });
      const promise = workerService.runWorker(workerPath, { id: 1 });

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(workerService.getCurrentConcurrency()).toBe(1);

      const worker = await waitForWorkerInstance();
      worker.emit("message", { done: 1 });
      await promise;

      expect(workerService.getCurrentConcurrency()).toBe(0);
    }, 2000);

    it("should release semaphore even if worker fails", async () => {
      const workerService = new WorkerService({ maxConcurrentWorkers: 1 });
      const promise = workerService.runWorker(workerPath, { id: 1 });

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(workerService.getCurrentConcurrency()).toBe(1);

      const worker = await waitForWorkerInstance();
      worker.emit("error", new Error("fail!"));

      await expect(promise).rejects.toThrow("fail!");
      expect(workerService.getCurrentConcurrency()).toBe(0);
    }, 2000);

    it("should handle multiple concurrent workers correctly", async () => {
      const workerService = new WorkerService({ maxConcurrentWorkers: 3 });
      const promises = Array.from({ length: 5 }, (_, i) =>
        workerService.runWorker(workerPath, { id: i + 1 })
      );

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(workerService.getCurrentConcurrency()).toBeLessThanOrEqual(3);

      const workers = (Worker as any).instances;
      for (let i = 0; i < workers.length; i++) {
        workers[i].emit("message", { done: i + 1 });
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      // Aguarda todas as promessas serem resolvidas
      await Promise.all(promises);
      expect(workerService.getCurrentConcurrency()).toBe(0);
    }, 3000);
  });

  describe("Retry Strategy", () => {
    it("should not retry when retryStrategy is not configured", async () => {
      const promise = workerService.runWorker(workerPath, { id: 1 });
      const worker = await waitForWorkerInstance();
      worker.emit("error", new Error("fail!"));
      await expect(promise).rejects.toThrow("fail!");
    }, 2000);

    it("should use retry strategy when configured", async () => {
      const workerService = new WorkerService({
        retryStrategy: { maxRetries: 2, backoffMs: 50 },
      });
      const promise = workerService.runWorker(workerPath, { id: 1 });

      // Primeira tentativa
      const worker1 = await waitForWorkerInstance();
      worker1.emit("error", new Error("fail!"));

      // Aguarda o backoff da primeira tentativa (50ms + jitter)
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Segunda tentativa
      const worker2 = await waitForWorkerInstance();
      worker2.emit("error", new Error("fail!"));

      // Aguarda o backoff da segunda tentativa (100ms + jitter)
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Terceira tentativa
      const worker3 = await waitForWorkerInstance();
      worker3.emit("error", new Error("fail!"));

      await expect(promise).rejects.toThrow("fail!");
    }, 5000);
  });

  describe("Temporary File Management", () => {
    it("should create and cleanup temporary file for function handlers", async () => {
      const handler = async (data: any) => data;
      const promise = workerService.runWorker(handler, { id: 1 });

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(writeFileSync).toHaveBeenCalled();
      const tempFilePath = (writeFileSync as jest.Mock).mock.calls[0][0];

      const worker = await waitForWorkerInstance(500);
      worker.emit("message", { result: 42 });
      await promise;

      expect(unlinkSync).toHaveBeenCalledWith(tempFilePath);
    }, 3000);

    it("should cleanup temporary file on worker error", async () => {
      const handler = async (data: any) => data;
      const promise = workerService.runWorker(handler, { id: 1 });

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(writeFileSync).toHaveBeenCalled();
      const tempFilePath = (writeFileSync as jest.Mock).mock.calls[0][0];

      const worker = await waitForWorkerInstance(500);
      worker.emit("error", new Error("fail!"));
      await expect(promise).rejects.toThrow("fail!");
      expect(unlinkSync).toHaveBeenCalledWith(tempFilePath);
    }, 3000);

    it("should cleanup temporary file on worker timeout", async () => {
      const handler = async (data: any) => data;
      const promise = workerService.runWorker(
        handler,
        { id: 1 },
        { workerTimeout: 200 }
      );
      await new Promise((r) => setTimeout(r, 200));
      expect(writeFileSync).toHaveBeenCalled();
      const tempFilePath = (writeFileSync as jest.Mock).mock.calls[0][0];
      await expect(promise).rejects.toThrow("Worker timeout");
      expect(unlinkSync).toHaveBeenCalledWith(tempFilePath);
    }, 3000);

    it("should cleanup temporary file on worker exit with non-zero code", async () => {
      const handler = async (data: any) => data;
      const promise = workerService.runWorker(handler, { id: 1 });

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(writeFileSync).toHaveBeenCalled();
      const tempFilePath = (writeFileSync as jest.Mock).mock.calls[0][0];

      const worker = await waitForWorkerInstance(500);
      worker.emit("exit", 1);

      try {
        await promise;
      } catch (error) {
        expect(error.message).toBe("Worker stopped with exit code 1");
      }

      expect(unlinkSync).toHaveBeenCalledWith(tempFilePath);
    }, 3000);

    it("should not create temporary file for string path handlers", async () => {
      const promise = workerService.runWorker(workerPath, { id: 1 });
      const worker = await waitForWorkerInstance();
      worker.emit("message", { result: 42 });
      await new Promise((r) => setImmediate(r));
      await expect(promise).resolves.toEqual({ result: 42 });
      expect(writeFileSync).not.toHaveBeenCalled();
    }, 1000);

    it("should handle cleanup errors gracefully", async () => {
      const handler = async (data: any) => data;
      const promise = workerService.runWorker(handler, { id: 1 });
      await new Promise((r) => setTimeout(r, 100));
      expect(writeFileSync).toHaveBeenCalled();
      (unlinkSync as jest.Mock).mockImplementationOnce(() => {
        throw new Error("Failed to delete file");
      });
      const worker = await waitForWorkerInstance();
      worker.emit("message", { result: 42 });
      await new Promise((r) => setImmediate(r));
      await expect(promise).resolves.toEqual({ result: 42 });
    }, 1000);
  });
});
