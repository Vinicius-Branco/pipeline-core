# Graceful Shutdown - Pipeline Core

## 📋 Overview

The **Graceful Shutdown** system allows the pipeline to be terminated in a controlled and safe manner, ensuring that:

- ✅ Ongoing executions are completed properly
- ✅ Workers are terminated without data loss
- ✅ Resources are cleaned up correctly
- ✅ Timeouts are respected to prevent hanging
- ✅ Events are emitted for monitoring

## 🚀 How to Use

### 1. Basic Shutdown

```typescript
import { PipelineService } from "pipeline-core";

const pipeline = new PipelineService(config);

// Shutdown with default timeout (30 seconds)
await pipeline.shutdown();

// Shutdown with custom timeout
await pipeline.shutdown(10000); // 10 seconds
```

### 2. Shutdown with Callbacks

```typescript
await pipeline.shutdown({
  timeout: 15000,
  onShutdownStart: () => {
    console.log("🔄 Starting shutdown...");
  },
  onShutdownComplete: () => {
    console.log("✅ Shutdown completed");
  },
  onTimeout: () => {
    console.log("⏰ Timeout reached, forcing shutdown");
  },
});
```

### 3. State Verification

```typescript
// Check if shutting down
if (pipeline.isShuttingDown()) {
  console.log("Pipeline is being terminated...");
}

// Check if already terminated
if (pipeline.isShutdown()) {
  console.log("Pipeline has already been terminated");
}

// Get current state
console.log("State:", pipeline.getState()); // RUNNING | SHUTTING_DOWN | SHUTDOWN
```

### 4. Active Executions Monitoring

```typescript
// Count active executions
const activeCount = pipeline.getActiveExecutions();
console.log(`Active executions: ${activeCount}`);

// Wait for all executions to complete
await pipeline.waitForCompletion();
```

## 📡 Operating System Integration

### Signal Capture

```typescript
// SIGTERM (graceful shutdown)
process.on("SIGTERM", async () => {
  console.log("📡 Received SIGTERM, starting shutdown...");
  try {
    await pipeline.shutdown(10000);
    console.log("Shutdown completed");
    process.exit(0);
  } catch (error) {
    console.error("Shutdown failed:", error.message);
    process.exit(1);
  }
});

// SIGINT (Ctrl+C)
process.on("SIGINT", async () => {
  console.log("📡 Received SIGINT, starting shutdown...");
  try {
    await pipeline.shutdown(5000);
    console.log("Shutdown completed");
    process.exit(0);
  } catch (error) {
    console.error("Shutdown failed:", error.message);
    process.exit(1);
  }
});

// Ensure cleanup before exiting
process.on("beforeExit", async () => {
  if (!pipeline.isShutdown()) {
    console.log("🔄 Ensuring shutdown before exiting...");
    await pipeline.shutdown(3000);
  }
});
```

## 📊 Shutdown Events

### Event Listening

```typescript
pipeline.onEvent((event) => {
  switch (event.type) {
    case "SHUTDOWN_START":
      console.log("🔄 Shutdown started");
      break;
    case "SHUTDOWN_COMPLETE":
      console.log("✅ Shutdown completed successfully");
      break;
    case "SHUTDOWN_TIMEOUT":
      console.log("⏰ Shutdown timeout reached");
      break;
    case "SHUTDOWN_ERROR":
      console.log("❌ Error during shutdown:", event.error?.message);
      break;
    case "WORKER_ABORTED":
      console.log("🛑 Worker aborted during shutdown");
      break;
    case "EXECUTION_CANCELLED":
      console.log("❌ Execution cancelled during shutdown");
      break;
  }
});
```

### Event Context

Each shutdown event includes detailed context:

```typescript
interface ShutdownContext {
  pipelineId: string; // Pipeline ID
  executionId: string; // Shutdown execution ID
  startTime: number; // Start timestamp
  timeout: number; // Configured timeout
  activeExecutions: number; // Active executions at start
  activeWorkers: number; // Active workers at start
}
```

## 🔧 Advanced Configuration

### Component Timeouts

```typescript
// Timeout to wait for active executions
const executionTimeout = 10000; // 10 seconds

// Timeout to terminate workers
const workerTimeout = 15000; // 15 seconds

// Total shutdown timeout
const totalTimeout = Math.max(executionTimeout, workerTimeout) + 5000;
```

### Forced Shutdown

```typescript
// If timeout is reached, the system forces shutdown
try {
  await pipeline.shutdown(5000); // Short timeout
} catch (error) {
  console.log("Timeout reached, forced shutdown applied");
  // The system automatically:
  // 1. Cancels active executions
  // 2. Aborts workers
  // 3. Cleans up resources
}
```

## 🏗️ Internal Architecture

### Pipeline States

```typescript
enum PipelineState {
  RUNNING = "RUNNING", // Running normally
  SHUTTING_DOWN = "SHUTTING_DOWN", // In shutdown process
  SHUTDOWN = "SHUTDOWN", // Terminated
}
```

### Shutdown Flow

```
1. User calls pipeline.shutdown()
2. State changes to SHUTTING_DOWN
3. Stops accepting new executions
4. Waits for active executions (with timeout)
5. Terminates active workers
6. Cleans up resources (semaphores, temp files)
7. State changes to SHUTDOWN
8. Emits SHUTDOWN_COMPLETE event
```

### Involved Components

- **PipelineService**: Orchestrates overall shutdown
- **WorkerService**: Terminates workers and cleans up resources
- **SemaphoreService**: Controls concurrency during shutdown
- **MonitoringService**: Emits monitoring events

## ⚠️ Important Considerations

### 1. Timeouts

- **Default timeout**: 30 seconds
- **Minimum recommended timeout**: 5 seconds
- **Production timeout**: 60+ seconds for complex pipelines

### 2. Active Executions

- Already started executions continue until timeout
- New executions are rejected during shutdown
- Executions can be cancelled if timeout is reached

### 3. Workers

- Active workers receive abort signal
- Temporary files are cleaned up automatically
- Semaphores are properly terminated

### 4. Resources

- All resources are cleaned up automatically
- Temporary files are removed
- Event listeners are removed

## 🧪 Testing Shutdown

### Test Example

```typescript
// Basic test
const pipeline = new PipelineService(config);

// Start long execution
const longExecution = pipeline.execute({
  data: { id: "test" },
  currentStep: "step1",
});

// Wait a bit and start shutdown
setTimeout(async () => {
  console.log("Starting shutdown...");
  await pipeline.shutdown(5000);
  console.log("Shutdown completed");
}, 1000);

// Check result
try {
  const result = await longExecution;
  console.log("Execution completed:", result);
} catch (error) {
  console.log("Execution cancelled:", error.message);
}
```

### Recommended Checks

1. **Shutdown during normal execution**
2. **Shutdown with multiple executions**
3. **Shutdown with short timeout (forces shutdown)**
4. **Shutdown with callbacks**
5. **Integration with system signals**
6. **Resource cleanup after shutdown**

## 🚨 Troubleshooting

### Common Issues

1. **Timeout too short**

   - Increase timeout for complex pipelines
   - Monitor average execution time

2. **Workers don't terminate**

   - Check if handlers respond to AbortSignal
   - Implement proper cleanup in handlers

3. **Resources not cleaned up**

   - Check if cleanup() is called
   - Monitor temporary files

4. **Events not emitted**
   - Check if listeners are registered
   - Confirm events are captured

### Useful Logs

```typescript
pipeline.onEvent((event) => {
  console.log(`[${new Date().toISOString()}] ${event.type}:`, {
    step: event.step,
    duration: "duration" in event ? event.duration : undefined,
    context: "context" in event ? event.context : undefined,
  });
});
```

## 📈 Monitoring

### Important Metrics

- **Shutdown time**: Total duration of the process
- **Cancelled executions**: Number of interrupted executions
- **Aborted workers**: Number of workers forced to stop
- **Timeouts**: Frequency of reached timeouts

### Recommended Alerts

- Shutdown taking longer than 60 seconds
- Many executions being cancelled
- Workers being aborted frequently
- Timeouts being reached regularly
