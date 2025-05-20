import { Worker } from "worker_threads";
import { PipelineOptions } from "../types/index.js";
import { retryWithBackoff } from "./retry";

interface QueuedWorker<TInput, TResult> {
  path: string;
  data: TInput;
  resolve: (value: TResult) => void;
  reject: (reason?: any) => void;
  retryCount: number;
}

export class WorkerService {
  private activeWorkers: Set<Worker> = new Set();
  private workerQueue: QueuedWorker<any, any>[] = [];
  private readonly options: Required<PipelineOptions>;
  private isProcessingQueue: boolean = false;

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

  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue || this.workerQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    try {
      while (this.workerQueue.length > 0) {
        const availableSlots =
          this.options.maxConcurrentWorkers - this.activeWorkers.size;

        if (availableSlots <= 0) {
          // Wait for a worker to become available
          await new Promise((resolve) => {
            const checkInterval = setInterval(() => {
              if (this.activeWorkers.size < this.options.maxConcurrentWorkers) {
                clearInterval(checkInterval);
                resolve(true);
              }
            }, 100);
          });
        }

        const batch = this.workerQueue.splice(0, availableSlots);
        await Promise.all(
          batch.map((queuedWorker) =>
            this.runWorker(queuedWorker.path, queuedWorker.data).then(
              queuedWorker.resolve,
              queuedWorker.reject
            )
          )
        );
      }
    } finally {
      this.isProcessingQueue = false;
    }
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

  getQueuedWorkersCount(): number {
    return this.workerQueue.length;
  }

  getTotalWorkersCount(): number {
    return this.activeWorkers.size + this.workerQueue.length;
  }
}
