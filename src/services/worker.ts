import { Worker } from "worker_threads";
import { PipelineOptions } from "../types/index.js";
import { retryWithBackoff } from "./retry";

export class WorkerService {
  private activeWorkers: Set<Worker> = new Set();
  private readonly options: Required<PipelineOptions>;

  constructor(options?: PipelineOptions) {
    this.options = {
      workerTimeout: options?.workerTimeout ?? 10_000,
      maxConcurrentWorkers: options?.maxConcurrentWorkers ?? 10,
      retryStrategy: options?.retryStrategy ?? {
        maxRetries: 3,
        backoffMs: 1000,
      },
    };
  }

  private async executeWorker<TInput, TResult>(
    path: string,
    data: TInput
  ): Promise<TResult> {
    return new Promise<TResult>((resolve, reject) => {
      const worker = new Worker(path, {
        workerData: data,
      });

      this.activeWorkers.add(worker);

      const timeout = setTimeout(() => {
        worker.terminate();
        this.activeWorkers.delete(worker);
        reject(new Error("Worker timed out"));
      }, this.options.workerTimeout);

      worker.on("message", (result: TResult) => {
        clearTimeout(timeout);
        this.activeWorkers.delete(worker);
        resolve(result);
      });

      worker.on("error", (err) => {
        clearTimeout(timeout);
        this.activeWorkers.delete(worker);
        reject(err);
      });

      worker.on("exit", (code) => {
        this.activeWorkers.delete(worker);
        if (code !== 0) {
          reject(new Error(`Worker stopped with exit code ${code}`));
        }
      });
    });
  }

  async runWorker<TInput, TResult>(
    path: string,
    data: TInput
  ): Promise<TResult> {
    return retryWithBackoff(
      () => this.executeWorker<TInput, TResult>(path, data),
      this.options.retryStrategy.maxRetries,
      this.options.retryStrategy.backoffMs
    );
  }

  getActiveWorkersCount(): number {
    return this.activeWorkers.size;
  }

  getTotalWorkersCount(): number {
    return this.activeWorkers.size;
  }
}
