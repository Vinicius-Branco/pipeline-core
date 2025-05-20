import { WorkerService } from "./worker";
import { Worker } from "worker_threads";

jest.mock("worker_threads", () => {
  const events: Record<string, Array<(...args: unknown[]) => void>> = {};
  class MockWorker {
    static lastInstance: MockWorker;
    on: jest.Mock;
    terminate: jest.Mock;
    constructor(_path: string, _opts: unknown) {
      this.on = jest.fn((event, cb) => {
        events[event] = events[event] || [];
        events[event].push(cb);
      });
      this.terminate = jest.fn();
      MockWorker.lastInstance = this;
    }
    emit(event: string, ...args: unknown[]) {
      (events[event] || []).forEach((cb) => cb(...args));
    }
  }
  return { Worker: MockWorker };
});

describe("WorkerService", () => {
  let workerService: WorkerService;
  const workerPath = "mock/path.js";

  beforeEach(() => {
    workerService = new WorkerService({
      workerTimeout: 100,
      maxConcurrentWorkers: 2,
      retryStrategy: { maxRetries: 0, backoffMs: 10 }, // retry is tested separately
    });
    jest.clearAllMocks();
  });

  it("should execute a worker and resolve with result", async () => {
    const promise = workerService.runWorker(workerPath, { foo: "bar" });
    // Simulate worker message
    const MockWorker = Worker as unknown as {
      lastInstance: { emit: (event: string, data: unknown) => void };
    };
    MockWorker.lastInstance.emit("message", { result: 42 });
    await expect(promise).resolves.toEqual({ result: 42 });
  });

  it("should reject if worker times out", async () => {
    const promise = workerService.runWorker(workerPath, { foo: "bar" });
    // Do not emit message, let timeout happen
    await expect(promise).rejects.toThrow("Worker timed out");
  });

  it("should reject if worker emits error", async () => {
    const promise = workerService.runWorker(workerPath, { foo: "bar" });
    const MockWorker = Worker as unknown as {
      lastInstance: { emit: (event: string, error: Error) => void };
    };
    MockWorker.lastInstance.emit("error", new Error("fail!"));
    await expect(promise).rejects.toThrow("fail!");
  });

  it("should respect maxConcurrentWorkers and queue jobs", async () => {
    const promises = [
      workerService.runWorker(workerPath, { id: 1 }),
      workerService.runWorker(workerPath, { id: 2 }),
      workerService.runWorker(workerPath, { id: 3 }),
    ];
    const MockWorker = Worker as unknown as {
      lastInstance: { emit: (event: string, data: unknown) => void };
    };
    // Complete all
    MockWorker.lastInstance.emit("message", { done: 1 });
    MockWorker.lastInstance.emit("message", { done: 2 });
    MockWorker.lastInstance.emit("message", { done: 3 });
    const results = await Promise.allSettled(promises);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
  });
});
