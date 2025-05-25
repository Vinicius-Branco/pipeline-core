import { PipelineService } from "../services/pipeline.js";
import {
  PipelineConfig,
  ErrorAction,
  ErrorContext,
  ErrorActionType,
} from "../types/index.js";

// Define the steps of the pipeline
type PipelineSteps =
  | "step1"
  | "step2"
  | "step3"
  | "errorHandler"
  | "deadLetter";

// Pipeline configuration with built-in error handlers
const config: PipelineConfig<PipelineSteps> = {
  steps: [
    {
      name: "step1",
      handler: async (data: { value: number }) => {
        console.log("Executing step1 with function");
        return { ...data, value: data.value + 1 };
      },
      options: {
        workerTimeout: 10000,
        retryStrategy: {
          maxRetries: 5,
          backoffMs: 2000,
        },
      },
      errorHandlers: {
        onError: async (
          error: Error,
          _context: ErrorContext
        ): Promise<ErrorAction> => {
          console.log("Error in step1:", error.message);
          return { type: ErrorActionType.RETRY, maxRetries: 2 };
        },
        onRetry: async (context: ErrorContext): Promise<void> => {
          console.log(`Attempt ${context.retryCount} in step1`);
        },
      },
    },
    {
      name: "step2",
      handler: async (data: { value: number }) => {
        console.log("Executing step2 with function");
        return { ...data, value: data.value + 1 };
      },
      options: {
        maxConcurrentWorkers: 2,
      },
      errorHandlers: {
        onError: async (
          error: Error,
          _context: ErrorContext
        ): Promise<ErrorAction> => {
          console.log("Error in step2:", error.message);
          return { type: ErrorActionType.CONTINUE, nextStep: "errorHandler" };
        },
        onContinue: async (_context: ErrorContext): Promise<void> => {
          console.log("Skipping to errorHandler after error in step2");
        },
      },
    },
    {
      name: "step3",
      handler: async (data: { value: number }) => {
        console.log("Executing step3 with function");
        if (data.value > 5) {
          throw new Error("Value too high!");
        }
        return { ...data, value: data.value * 2 };
      },
      errorHandlers: {
        onError: async (
          error: Error,
          _context: ErrorContext
        ): Promise<ErrorAction> => {
          console.log("Error in step3:", error.message);
          return {
            type: ErrorActionType.CUSTOM,
            handler: async (
              _error: Error,
              _context: ErrorContext
            ): Promise<ErrorAction> => {
              console.log("Sending to dead letter");
              return { type: ErrorActionType.STOP };
            },
          };
        },
        onStop: async (_context: ErrorContext): Promise<void> => {
          console.log("Pipeline stopped after error in step3");
        },
      },
    },
    {
      name: "errorHandler",
      handler: async (data: { value: number }) => {
        console.log("Executing errorHandler with function");
        return { ...data, value: data.value + 1 };
      },
      errorHandlers: {
        onError: async (
          error: Error,
          _context: ErrorContext
        ): Promise<ErrorAction> => {
          console.log("Error in errorHandler:", error.message);
          return { type: ErrorActionType.STOP };
        },
      },
    },
    {
      name: "deadLetter",
      handler: async (data: { value: number }) => {
        console.log("Executing deadLetter with function");
        console.log("Rejected data:", data);
        return data;
      },
      errorHandlers: {
        onError: async (
          error: Error,
          _context: ErrorContext
        ): Promise<ErrorAction> => {
          console.log("Error in deadLetter:", error.message);
          return { type: ErrorActionType.STOP };
        },
      },
    },
  ],
  options: {
    workerTimeout: 5000,
    maxConcurrentWorkers: 5,
    retryStrategy: {
      maxRetries: 3,
      backoffMs: 1000,
    },
  },
};

// Create pipeline instance
const pipeline = new PipelineService<PipelineSteps, { value: number }>(config);

// Add listener for events
pipeline.onEvent((event) => {
  switch (event.type) {
    case "ERROR":
      console.log(`Error in step ${event.step}:`, event.error.message);
      break;
    case "RETRY":
      console.log(`Attempt ${event.context.retryCount} in step ${event.step}`);
      break;
    case "STOP":
      console.log(`Pipeline stopped in step ${event.step}`);
      break;
  }
});

// Example of usage
async function runPipeline() {
  try {
    const result = await pipeline.execute({
      data: { value: 1 },
      currentStep: "step1",
    });

    console.log("Pipeline completed:", result);
  } catch (error) {
    console.error("Fatal error in pipeline:", error);
  }
}

runPipeline();
