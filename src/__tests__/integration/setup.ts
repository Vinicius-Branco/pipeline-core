// Configura o ambiente para os testes de integração
process.env.ESBUILD_LOG_LEVEL = "error";

// Suprime a saída do esbuild durante os testes
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

console.log = (...args: any[]) => {
  if (!args[0]?.includes("esbuild")) {
    originalConsoleLog(...args);
  }
};

console.error = (...args: any[]) => {
  if (!args[0]?.includes("esbuild")) {
    originalConsoleError(...args);
  }
};

import { PipelineService } from "../../services/pipeline.service";
import { ErrorActionType } from "../../types";

// Flexible setup function for tests
export const setupTestPipeline = (steps?: any[], options?: any) => {
  // Default steps for general cases
  const defaultSteps = [
    {
      name: "step1",
      handler: async (data: { value: number }) => {
        return { ...data, value: data.value + 1 };
      },
      options: {
        workerTimeout: 5000,
        retryStrategy: {
          maxRetries: 2,
          backoffMs: 1000,
        },
      },
    },
    {
      name: "step2",
      handler: async (data: { value: number }) => {
        return { ...data, value: data.value * 2 };
      },
    },
    {
      name: "slowStep",
      handler: async (data: { value: number }) => {
        await new Promise((resolve) => setTimeout(resolve, 6000));
        return { ...data, value: data.value + 1 };
      },
      options: {
        workerTimeout: 5000,
      },
    },
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
  ];

  const config = {
    steps: steps || defaultSteps,
    options: options || {
      workerTimeout: 10000,
      maxConcurrentWorkers: 2,
      retryStrategy: {
        maxRetries: 3,
        backoffMs: 1000,
      },
    },
  };

  const pipeline = new PipelineService(config);
  pipeline["visitedSteps"] = new Set();
  return pipeline;
};
