# Pipeline Core

[![npm version](https://img.shields.io/npm/v/pipeline-core.svg)](https://www.npmjs.com/package/pipeline-core)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)
[![Node.js CI](https://github.com/Vinicius-Branco/pipeline-core/actions/workflows/node.js.yml/badge.svg)](https://github.com/Vinicius-Branco/pipeline-core/actions/workflows/node.js.yml)

A TypeScript library for managing complex data processing pipelines with advanced error handling, retry mechanisms, and parallel processing capabilities.

## Features

- 🔄 Asynchronous step processing
- 🔁 Advanced retry mechanisms with exponential backoff
- ⚡ Parallel processing with concurrency control
- 🛡️ Comprehensive error handling with custom strategies
- 🔍 Step-by-step execution tracking
- 📊 Event-based monitoring
- 🎯 Type-safe with TypeScript
- 🔒 Infinite loop prevention
- 👥 Worker thread support for heavy processing
- 📈 Detailed performance monitoring
- 🔄 Per-step customizable retry strategies

## Installation

```bash
npm install pipeline-core
```

## Basic Usage

```typescript
import {
  PipelineService,
  PipelineConfig,
  ErrorActionType,
} from "pipeline-core";

// Define pipeline steps
type PipelineSteps = "step1" | "step2" | "step3";

// Configure the pipeline
const config: PipelineConfig<PipelineSteps> = {
  steps: [
    {
      name: "step1",
      handler: async (data) => {
        // Process data
        return { ...data, processed: true };
      },
      errorHandlers: {
        onError: async (error, context) => ({
          type: ErrorActionType.RETRY,
          maxRetries: 3,
        }),
      },
    },
    // Add more steps...
  ],
  options: {
    maxConcurrentWorkers: 5,
    retryStrategy: {
      maxRetries: 3,
      backoffMs: 1000,
    },
  },
};

// Create pipeline instance
const pipeline = new PipelineService<PipelineSteps, YourDataType>(config);

// Execute pipeline
const result = await pipeline.execute({
  data: yourData,
  currentStep: "step1",
});
```

## Advanced Features

### Error Handling

The library provides sophisticated error handling capabilities:

```typescript
{
  errorHandlers: {
    onError: async (error, context) => ({
      type: ErrorActionType.RETRY, // or CONTINUE, STOP, CUSTOM
      maxRetries: 3
    }),
    onRetry: async (context) => {
      // Custom retry logic
    },
    onContinue: async (context) => {
      // Custom continue logic
    },
    onStop: async (context) => {
      // Custom stop logic
    }
  }
}
```

### Event Monitoring

Monitor pipeline execution with event listeners:

```typescript
pipeline.onEvent((event) => {
  switch (event.type) {
    case "ERROR":
      console.error(`Error in step ${event.step}:`, event.error);
      break;
    // Handle other event types...
  }
});
```

### Parallel Processing

Process multiple items in parallel with controlled concurrency:

```typescript
const results = await pipeline.execute([
  { data: item1, currentStep: "step1" },
  { data: item2, currentStep: "step1" },
]);
```

### Worker Threads

Execute heavy processing in separate threads:

```typescript
const config: PipelineConfig<"step1"> = {
  steps: [
    {
      name: "step1",
      handler: "./worker.js", // Path to worker file
    },
  ],
};
```

### Handling External Dependencies in Workers

When using function handlers in your pipeline steps, it's important to note that the `worker_threads` module requires all code to be serialized into a file before execution. This means that any external dependencies need to be explicitly required within the handler function:

```typescript
const config: PipelineConfig<"step1"> = {
  steps: [
    {
      name: "step1",
      handler: async (data) => {
        // External dependencies must be required inside the handler
        const axios = require("axios");

        const response = await axios.get("https://api.example.com/data");
        return { ...data, apiData: response.data };
      },
    },
  ],
};
```

This approach is necessary because:

1. The worker thread runs in an isolated context
2. The handler function is serialized into a temporary file
3. Dependencies need to be explicitly loaded within the worker's context
4. The worker needs to have access to all required modules at runtime

### Handling Internal Module Imports

When importing internal modules (files from your project), you need to handle the default exports correctly. Here's an example:

```typescript
// requester.ts
import axios from "axios";

const requester = async () => {
  const response = await axios.get("https://api.example.com/data");
  return response;
};

export default requester;

// pipeline.ts
const config: PipelineConfig<"step1"> = {
  steps: [
    {
      name: "step1",
      handler: async (data) => {
        // Access the default export using .default
        const requester = require("./requester").default;
        const response = await requester();
        return { ...data, apiData: response.data };
      },
    },
  ],
};
```

Note that when using `require()` with ES modules that have default exports, you need to access the `default` property to get the exported function or value.

## Configuration

### PipelineConfig

```typescript
interface PipelineConfig<TStep extends string> {
  steps: StepConfig<TStep>[];
  options?: StepOptions;
}
```

### StepConfig

```typescript
interface StepConfig<TStep extends string> {
  name: TStep;
  handler: StepHandler;
  errorHandlers?: {
    onError?: (error: Error, context: ErrorContext) => Promise<ErrorAction>;
    onRetry?: (context: ErrorContext) => Promise<void>;
    onContinue?: (context: ErrorContext) => Promise<void>;
    onStop?: (context: ErrorContext) => Promise<void>;
  };
  options?: StepOptions;
}
```

### StepOptions

```typescript
interface StepOptions {
  maxConcurrentWorkers?: number; // Default: 10
  retryStrategy?: {
    maxRetries: number; // Default: 3
    backoffMs: number; // Default: 1000
  };
  workerTimeout?: number; // Worker timeout
  transpileAlways?: boolean; // Always transpile workers
}
```

## Error Actions

The library supports multiple error handling strategies:

- `RETRY`: Retry the current step with configurable attempts
- `CONTINUE`: Skip to a specified next step
- `STOP`: Halt pipeline execution
- `CUSTOM`: Implement custom error handling logic

## How It Works Under the Hood

The pipeline is designed to process data through a series of steps, where each step can be executed independently and concurrently. Here's a breakdown of how it works:

- **Independent Worker Services**: Each step in the pipeline has its own `WorkerService` instance. This allows each step to manage its own concurrency and execution independently.

- **Concurrent Processing**: Within each step, multiple workers can operate concurrently, controlled by a semaphore that limits the number of active workers. This ensures that heavy processing tasks do not overwhelm the system.

- **Parallel Step Execution**: While each step's workers operate concurrently, the steps themselves are processed in parallel. This means that as soon as one step completes, the next step can begin processing, allowing for a smooth and efficient data flow through the pipeline.

- **Event Propagation**: The pipeline uses an event-based monitoring system to track the execution of each step. Events are emitted at the start and end of each step, allowing for detailed monitoring and logging of the pipeline's execution.

- **Error Handling and Retries**: Each step can be configured with custom error handling strategies, including retries with exponential backoff. This ensures that transient errors do not halt the pipeline's execution.

- **Type Safety**: The entire pipeline is built with TypeScript, providing type safety and ensuring that the data flowing through the pipeline is correctly typed and validated.

This architecture allows for a highly scalable and efficient data processing pipeline, capable of handling complex workflows with ease.

## Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) before submitting a pull request.

## License

MIT

## Support

For support, please open an issue in the GitHub repository or contact the maintainers.

## Mutation Testing

The project uses [Stryker Mutator](https://stryker-mutator.io/) for mutation testing, which now supports both unit and integration tests.

### Available Commands

```bash
# Mutation testing with unit tests only (faster)
npm run test:mutation:unit

# Mutation testing with integration tests only
npm run test:mutation:integration

# Mutation testing with all tests
npm run test:mutation:all

# Default mutation testing (all tests)
npm run test:mutation

# Quick preview (console only)
npm run test:mutation:preview
```

### Configurations

- **Unit** (`stryker.unit.conf.mjs`): Focus on business logic, faster
- **Integration** (`stryker.integration.conf.mjs`): Focus on system behavior, slower
- **Complete** (`stryker.conf.mjs`): All tests, maximum coverage

See [MUTATION_TESTING.md](./MUTATION_TESTING.md) for complete details on configuration and usage.
