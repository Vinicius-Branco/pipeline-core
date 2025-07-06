import { PipelineService } from "../services/pipeline.service.js";
import { PipelineConfig, SHUTDOWN_EVENT_TYPES } from "../types/index.js";
import os from "os";

// Define the steps of the pipeline
type PipelineSteps = "step1" | "step2" | "step3";

// Pipeline configuration with long-running steps to demonstrate shutdown
const config: PipelineConfig<PipelineSteps> = {
  steps: [
    {
      name: "step1",
      handler: async (data) => {
        console.log("Step 1: Starting...");
        await new Promise((resolve) => setTimeout(resolve, 2000));
        console.log("Step 1: Completed");
        return { ...data, step1: "completed" };
      },
    },
    {
      name: "step2",
      handler: async (data) => {
        console.log("Step 2: Starting...");
        await new Promise((resolve) => setTimeout(resolve, 3000));
        console.log("Step 2: Completed");
        return { ...data, step2: "completed" };
      },
    },
    {
      name: "step3",
      handler: async (data) => {
        console.log("Step 3: Starting...");
        await new Promise((resolve) => setTimeout(resolve, 2000));
        console.log("Step 3: Completed");
        return { ...data, step3: "completed" };
      },
    },
  ],
  options: {
    maxConcurrentWorkers: os.cpus().length,
    workerTimeout: 30000,
  },
};

// Create pipeline instance
const pipeline = new PipelineService<PipelineSteps, Record<string, unknown>>(
  config
);

// Subscribe to pipeline events including shutdown events
pipeline.onEvent((event) => {
  console.log("Event:", {
    type: event.type,
    step: event.step,
    duration: "duration" in event ? event.duration : undefined,
    timestamp: new Date(event.timestamp).toISOString(),
  });

  // Handle shutdown events specifically
  if (event.type === SHUTDOWN_EVENT_TYPES.SHUTDOWN_START) {
    console.log("🔄 Shutdown started...");
  } else if (event.type === SHUTDOWN_EVENT_TYPES.SHUTDOWN_COMPLETE) {
    console.log("✅ Shutdown completed successfully");
  } else if (event.type === SHUTDOWN_EVENT_TYPES.SHUTDOWN_TIMEOUT) {
    console.log("⏰ Shutdown timeout reached");
  } else if (event.type === SHUTDOWN_EVENT_TYPES.SHUTDOWN_ERROR) {
    console.log("❌ Shutdown error:", event.error?.message);
  }
});

// Example 1: Basic graceful shutdown
async function exampleBasicShutdown() {
  console.log("\n=== Example 1: Basic Graceful Shutdown ===");

  try {
    // Start pipeline execution
    const executionPromise = pipeline.execute({
      data: { id: "test-1" },
      currentStep: "step1",
    });

    // Wait a bit then initiate shutdown
    setTimeout(async () => {
      console.log("🛑 Initiating graceful shutdown...");
      await pipeline.shutdown(10000); // 10 second timeout
      console.log("Pipeline state:", pipeline.getState());
    }, 1500);

    const result = await executionPromise;
    console.log("Execution result:", result);
  } catch (error) {
    console.error("Execution error:", (error as Error).message);
  }
}

// Example 2: Shutdown with callbacks
async function exampleShutdownWithCallbacks() {
  console.log("\n=== Example 2: Shutdown with Callbacks ===");

  try {
    const executionPromise = pipeline.execute({
      data: { id: "test-2" },
      currentStep: "step1",
    });

    setTimeout(async () => {
      console.log("🛑 Initiating shutdown with callbacks...");
      await pipeline.shutdown({
        timeout: 8000,
        onShutdownStart: () => {
          console.log("📞 onShutdownStart callback called");
        },
        onShutdownComplete: () => {
          console.log("📞 onShutdownComplete callback called");
        },
        onTimeout: () => {
          console.log("📞 onTimeout callback called");
        },
      });
    }, 1000);

    const result = await executionPromise;
    console.log("Execution result:", result);
  } catch (error) {
    console.error("Execution error:", (error as Error).message);
  }
}

// Example 3: Multiple executions with shutdown
async function exampleMultipleExecutions() {
  console.log("\n=== Example 3: Multiple Executions ===");

  try {
    // Start multiple executions
    const executions = [
      pipeline.execute({ data: { id: "multi-1" }, currentStep: "step1" }),
      pipeline.execute({ data: { id: "multi-2" }, currentStep: "step1" }),
      pipeline.execute({ data: { id: "multi-3" }, currentStep: "step1" }),
    ];

    // Monitor active executions
    const monitorInterval = setInterval(() => {
      console.log(`Active executions: ${pipeline.getActiveExecutions()}`);
      console.log(`Pipeline state: ${pipeline.getState()}`);
    }, 1000);

    // Shutdown after some time
    setTimeout(async () => {
      clearInterval(monitorInterval);
      console.log("🛑 Shutting down with multiple executions...");
      await pipeline.shutdown(15000);
    }, 2000);

    // Wait for all executions
    const results = await Promise.allSettled(executions);
    console.log(
      "All executions completed:",
      results.map((r) => r.status)
    );
  } catch (error) {
    console.error("Error:", (error as Error).message);
  }
}

// Example 4: Integration with system signals
async function exampleSystemSignals() {
  console.log("\n=== Example 4: System Signal Integration ===");

  // Handle SIGTERM (graceful shutdown)
  process.on("SIGTERM", async () => {
    console.log("📡 Received SIGTERM, initiating graceful shutdown...");
    try {
      await pipeline.shutdown(10000);
      console.log("Graceful shutdown completed");
      process.exit(0);
    } catch (error) {
      console.error("Shutdown failed:", (error as Error).message);
      process.exit(1);
    }
  });

  // Handle SIGINT (Ctrl+C)
  process.on("SIGINT", async () => {
    console.log("📡 Received SIGINT, initiating graceful shutdown...");
    try {
      await pipeline.shutdown(5000);
      console.log("Graceful shutdown completed");
      process.exit(0);
    } catch (error) {
      console.error("Shutdown failed:", (error as Error).message);
      process.exit(1);
    }
  });

  // Handle beforeExit to ensure cleanup
  process.on("beforeExit", async () => {
    if (!pipeline.isShutdown()) {
      console.log("🔄 Ensuring pipeline shutdown before exit...");
      await pipeline.shutdown(3000);
    }
  });

  try {
    const executionPromise = pipeline.execute({
      data: { id: "signal-test" },
      currentStep: "step1",
    });

    console.log("Pipeline running... Press Ctrl+C to test graceful shutdown");
    console.log("Or send SIGTERM signal to test system integration");

    const result = await executionPromise;
    console.log("Execution completed:", result);
  } catch (error) {
    console.error("Execution error:", (error as Error).message);
  }
}

// Example 5: Force shutdown after timeout
async function exampleForceShutdown() {
  console.log("\n=== Example 5: Force Shutdown After Timeout ===");

  try {
    const executionPromise = pipeline.execute({
      data: { id: "force-test" },
      currentStep: "step1",
    });

    setTimeout(async () => {
      console.log(
        "🛑 Initiating shutdown with short timeout (force shutdown)..."
      );
      try {
        await pipeline.shutdown(1000); // Very short timeout to force shutdown
        console.log("Shutdown completed");
      } catch (error) {
        console.log("Shutdown timeout reached, force shutdown applied");
      }
    }, 500);

    const result = await executionPromise;
    console.log("Execution result:", result);
  } catch (error) {
    console.error("Execution error:", (error as Error).message);
  }
}

// Main function to run examples
async function runExamples() {
  console.log("🚀 Pipeline Graceful Shutdown Examples");
  console.log("=====================================");

  // Run examples sequentially
  await exampleBasicShutdown();
  await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait between examples

  await exampleShutdownWithCallbacks();
  await new Promise((resolve) => setTimeout(resolve, 2000));

  await exampleMultipleExecutions();
  await new Promise((resolve) => setTimeout(resolve, 2000));

  await exampleForceShutdown();
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Test system signal integration
  await exampleSystemSignals();

  console.log("\n✅ All examples completed!");
}

// Run the examples
runExamples().catch(console.error);
