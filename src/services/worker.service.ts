import { Worker } from "worker_threads";
import { PipelineOptions } from "../types/index";
import { retryWithBackoff } from "./retry.service";
import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { transpile, ScriptTarget, ModuleKind } from "typescript";
import { Semaphore } from "./semaphore.service";

interface WorkerError {
  error: string;
}

export class WorkerService {
  private readonly options: PipelineOptions;
  private tempFiles: Set<string> = new Set();
  private finalizedWorkers: Set<Worker> = new Set();
  private semaphore: Semaphore;

  constructor(options?: PipelineOptions) {
    this.options = {
      workerTimeout: options?.workerTimeout,
      maxConcurrentWorkers: options?.maxConcurrentWorkers ?? 10,
      retryStrategy: options?.retryStrategy,
      transpileAlways: options?.transpileAlways ?? true,
    };
    this.semaphore = new Semaphore(this.options.maxConcurrentWorkers ?? 10);
  }

  private isTypeScript(code: string): boolean {
    // Checks if the code contains TypeScript syntax
    const typescriptPatterns = [
      /:\s*[A-Z][a-zA-Z0-9]*(\[\])?(\s*\|\s*[A-Z][a-zA-Z0-9]*(\[\])?)*\s*[,)]/g, // type annotations
      /interface\s+[A-Z][a-zA-Z0-9]*/g, // interface declarations
      /type\s+[A-Z][a-zA-Z0-9]*/g, // type declarations
      /enum\s+[A-Z][a-zA-Z0-9]*/g, // enum declarations
      /<[A-Z][a-zA-Z0-9]*>/g, // generic types
      /as\s+[A-Z][a-zA-Z0-9]*/g, // type assertions
      /private|public|protected|readonly/g, // access modifiers
    ];

    return typescriptPatterns.some((pattern) => pattern.test(code));
  }

  private serializeHandler(handler: (data: any) => Promise<any>): string {
    // Returns the handler function code as is, without extracting just the body
    return handler.toString();
  }

  private finalizeWorker(worker: Worker, tempFile?: string): void {
    if (!this.finalizedWorkers.has(worker)) {
      this.finalizedWorkers.add(worker);
      worker.terminate();
      this.cleanupTempFile(tempFile);
    }
  }

  private async executeWorker<TInput, TResult>(
    handler: string | ((data: TInput) => Promise<TResult>),
    data: TInput,
    options: PipelineOptions
  ): Promise<TResult> {
    let tempFile: string | undefined;

    // if handler is a function, creates a temporary worker
    if (typeof handler === "function") {
      tempFile = join(tmpdir(), `worker-${Date.now()}.js`);
      const workerCode = `
        const { parentPort, workerData } = require("worker_threads");
        const tslib = require("tslib");

        const handler = ${this.serializeHandler(handler)};

        async function runWorker() {
          try {
            const abortController = new AbortController();
            const signal = abortController.signal;

            parentPort?.on('message', (message) => {
              if (message === 'abort') {
                abortController.abort();
              }
            });

            const result = await handler(workerData, { signal });
            parentPort?.postMessage(result);
          } catch (error) {
            if (error.name === 'AbortError') {
              parentPort?.postMessage({ error: 'Worker aborted' });
            } else {
              parentPort?.postMessage({ error: error?.message || String(error) });
            }
          }
        }

        runWorker();
      `;

      // Verifica se precisa transpilar
      const shouldTranspile =
        this.options.transpileAlways || this.isTypeScript(workerCode);
      const finalCode = shouldTranspile
        ? transpile(workerCode, {
            target: ScriptTarget.ES2018,
            module: ModuleKind.CommonJS,
            esModuleInterop: true,
            importHelpers: true,
            noEmitHelpers: true,
          })
        : workerCode;

      writeFileSync(tempFile, finalCode);
      this.tempFiles.add(tempFile);
      handler = tempFile;
    }

    return new Promise<TResult>((resolve, reject) => {
      const worker = new Worker(handler as string, {
        workerData: data,
      });

      let timeout: NodeJS.Timeout;
      let isResolved = false;

      const cleanup = () => {
        if (!isResolved) {
          isResolved = true;
          this.finalizeWorker(worker, tempFile);
        }
      };

      if (options.workerTimeout) {
        timeout = setTimeout(() => {
          worker.postMessage("abort");
          reject(new Error("Worker timeout"));
          cleanup();
        }, options.workerTimeout);
      }

      worker.on("message", (result: TResult | WorkerError) => {
        clearTimeout(timeout);
        if (result && typeof result === "object" && "error" in result) {
          reject(new Error((result as WorkerError).error));
        } else {
          resolve(result as TResult);
        }
        cleanup();
      });

      worker.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
        cleanup();
      });

      worker.on("exit", (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          reject(new Error(`Worker stopped with exit code ${code}`));
        }
        cleanup();
      });
    });
  }

  private cleanupTempFile(filePath?: string): void {
    if (filePath && this.tempFiles.has(filePath)) {
      try {
        unlinkSync(filePath);
        this.tempFiles.delete(filePath);
      } catch (error) {
        // ignore errors deleting temporary file
        // this is expected in some cases, like when the worker is still using the file
      }
    }
  }

  async runWorker<TInput, TResult>(
    handler:
      | string
      | ((
          data: TInput,
          options?: { signal?: AbortSignal }
        ) => Promise<TResult>),
    data: TInput,
    options?: PipelineOptions
  ): Promise<TResult> {
    const workerOptions = options || this.options;

    await this.semaphore.acquire();
    try {
      if (!workerOptions.retryStrategy) {
        const result = await this.executeWorker(handler, data, workerOptions);
        return result;
      }

      const result = await retryWithBackoff(
        () => this.executeWorker(handler, data, workerOptions),
        workerOptions.retryStrategy.maxRetries,
        workerOptions.retryStrategy.backoffMs
      );
      return result;
    } finally {
      this.semaphore.release();
    }
  }

  getActiveWorkersCount(): number {
    return this.semaphore.getCurrentConcurrency();
  }

  getCurrentConcurrency(): number {
    return this.semaphore.getCurrentConcurrency();
  }

  async cleanup(): Promise<void> {
    // Limpa todos os workers finalizados
    for (const worker of this.finalizedWorkers) {
      worker.terminate();
    }
    this.finalizedWorkers.clear();

    // Limpa todos os arquivos temporários
    for (const tempFile of this.tempFiles) {
      this.cleanupTempFile(tempFile);
    }
    this.tempFiles.clear();
  }
}
