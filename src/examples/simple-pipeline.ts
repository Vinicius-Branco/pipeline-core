import { PipelineService } from "../services/pipeline.js";
import { PipelineConfig } from "../types/index.js";
import path from "path";
import { fileURLToPath } from "url";

// Define pipeline steps
type PipelineSteps = "step1" | "step2" | "step3";

// Pipeline configuration
const config: PipelineConfig<PipelineSteps> = {
  steps: [
    {
      name: "step1",
      handler: path.resolve(
        fileURLToPath(import.meta.url),
        "../workers/step1.js"
      ),
    },
    {
      name: "step2",
      handler: path.resolve(
        fileURLToPath(import.meta.url),
        "../workers/step2.js"
      ),
    },
    {
      name: "step3",
      handler: path.resolve(
        fileURLToPath(import.meta.url),
        "../workers/step3.js"
      ),
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

// Usage example
async function runPipeline() {
  try {
    // Start pipeline from first step
    const result = await pipeline.execute([
      {
        data: { value: 1 },
        currentStep: "step1",
      },
    ]);

    console.log("Pipeline completed:", result);

    // Example of reprocessing from a specific step
    const reprocessResult = await pipeline.execute({
      data: { value: 2 },
      currentStep: "step2", // Start from step 2
    });

    console.log("Reprocessing completed:", reprocessResult);
  } catch (error) {
    console.error("Pipeline error:", error);
  }
}

runPipeline();
