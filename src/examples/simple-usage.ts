import { PipelineService } from "../services/pipeline.js";
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
        console.log("Executing step1 with function");
        return { ...data, step1: "completed" };
      },
    },
    {
      name: "step2",
      handler: async (data) => {
        console.log("Executing step2 with function");
        return { ...data, step2: "completed" };
      },
    },
  ],
  options: {
    // Using system's CPU count to optimize parallel processing
    maxConcurrentWorkers: os.cpus().length,
  },
};

// Create pipeline instance
const pipeline = new PipelineService<PipelineSteps, {}>(config);

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
