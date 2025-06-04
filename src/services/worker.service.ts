import { Worker } from "worker_threads";
import { PipelineOptions, StepOptions } from "../types/index";
import { retryWithBackoff } from "./retry.service";
import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Semaphore } from "./semaphore.service";
import { buildSync } from "esbuild";
import { delimiter } from "path";

interface WorkerError {
  error: string;
}

export class WorkerService {
  private readonly options: PipelineOptions;
  private tempFiles: Set<string> = new Set();
  private finalizedWorkers: Set<Worker> = new Set();
  private semaphores: Map<string, Semaphore> = new Map();
  private globalSemaphore: Semaphore;

  constructor(options?: PipelineOptions) {
    this.options = {
      workerTimeout: options?.workerTimeout,
      maxConcurrentWorkers: options?.maxConcurrentWorkers ?? 10,
      retryStrategy: options?.retryStrategy,
      transpileAlways: options?.transpileAlways ?? true,
    };
    this.globalSemaphore = new Semaphore(
      this.options.maxConcurrentWorkers ?? 10
    );
  }

  private getSemaphoreForStep(
    stepName: string,
    stepOptions?: StepOptions
  ): Semaphore {
    if (stepOptions?.maxConcurrentWorkers) {
      if (!this.semaphores.has(stepName)) {
        this.semaphores.set(
          stepName,
          new Semaphore(stepOptions.maxConcurrentWorkers)
        );
      }
      return this.semaphores.get(stepName)!;
    }
    return this.globalSemaphore;
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

    if (typeof handler === "function") {
      tempFile = join(tmpdir(), `worker-${Date.now()}-${Math.random()}.js`);
      const handlerCode = this.serializeHandler(handler);

      const workerCode = `
          const { parentPort, workerData } = require("worker_threads");

          // TypeScript helpers
          var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
              function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
              return new (P || (P = Promise))(function (resolve, reject) {
                  function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
                  function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
                  function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
                  step((generator = generator.apply(thisArg, _arguments || [])).next());
              });
          };

          const handler = ${handlerCode};

          parentPort?.on('message', (message) => {
            if (message === 'abort') {
              // Aborting is managed within the handler
            }
          });

          (async () => {
            try {
              const abortController = new AbortController();
              const signal = abortController.signal;

              const result = await handler(workerData, { signal });
              parentPort?.postMessage(result);
            } catch (error) {
              parentPort?.postMessage({ error: error?.message || String(error) });
            }
          })();
`;

      const shouldTranspile =
        this.options.transpileAlways || this.isTypeScript(workerCode);

      if (shouldTranspile) {
        buildSync({
          stdin: {
            contents: workerCode,
            resolveDir: process.cwd(),
            sourcefile: "worker.ts",
            loader: "ts",
          },
          bundle: true,
          platform: "node",
          target: "es2018",
          outfile: tempFile,
          format: "cjs",
          external: ["worker_threads"],
          minify: false,
          sourcemap: false,
        });
      } else {
        writeFileSync(tempFile, workerCode);
      }

      this.tempFiles.add(tempFile);
      handler = tempFile;
    }

    return new Promise<TResult>((resolve, reject) => {
      const worker = new Worker(handler as string, {
        workerData: data,
        env: {
          ...process.env,
          NODE_PATH: process.env.NODE_PATH
            ? `${
                process.env.NODE_PATH
              }${delimiter}${process.cwd()}/node_modules`
            : `${process.cwd()}/node_modules`,
        },
      });

      let timeout: NodeJS.Timeout | undefined;
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
    options?: PipelineOptions,
    stepName?: string,
    stepOptions?: StepOptions
  ): Promise<TResult> {
    const workerOptions = options || this.options;
    const semaphore = this.getSemaphoreForStep(
      stepName || "global",
      stepOptions
    );

    await semaphore.acquire();
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
      semaphore.release();
    }
  }

  getActiveWorkersCount(stepName?: string): number {
    if (stepName && this.semaphores.has(stepName)) {
      return this.semaphores.get(stepName)!.getCurrentConcurrency();
    }
    return this.globalSemaphore.getCurrentConcurrency();
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

    // Limpa todos os semáforos
    this.semaphores.clear();
  }
}
