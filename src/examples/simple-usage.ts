import { PipelineService } from "../services/pipeline.service.js";
import { PipelineConfig } from "../types/index.js";
import os from "os";

// Define the steps of the pipeline
type PipelineSteps = "step1" | "step2";

// Pipeline configuration with built-in error handlers
const config: PipelineConfig<PipelineSteps> = {
  steps: [
    {
      name: "step1",
      handler: async (data) => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return { ...data, step1: "completed" };
      },
    },
    {
      name: "step2",
      handler: async (data) => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return { ...data, step2: "completed" };
      },
    },
  ],
  options: {
    // Using system's CPU count to optimize parallel processing
    maxConcurrentWorkers: os.cpus().length,
    workerTimeout: 30000, // 30 seconds timeout
  },
};

// Create pipeline instance
const pipeline = new PipelineService<PipelineSteps, Record<string, unknown>>(
  config
);

// Subscribe to pipeline events
pipeline.onEvent((event) => {
  console.log("Event:", {
    type: event.type,
    step: event.step,
    duration: "duration" in event ? event.duration : undefined,
    timestamp: new Date(event.timestamp).toISOString(),
    context: "context" in event ? event.context : undefined,
  });
});

// Example of usage
async function runPipeline() {
  try {
    const result = await pipeline.execute({
      data: {},
      currentStep: "step1",
    });

    console.log("Pipeline completed:", result);
  } catch (error) {
    console.error("Fatal error in pipeline:", error);
  }
}

runPipeline();
