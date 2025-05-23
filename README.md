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
- �� Zero dependencies
- 📈 Integração com OpenTelemetry para observabilidade

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
}
```

## Error Actions

The library supports multiple error handling strategies:

- `RETRY`: Retry the current step with configurable attempts
- `CONTINUE`: Skip to a specified next step
- `STOP`: Halt pipeline execution
- `CUSTOM`: Implement custom error handling logic

## Integração com OpenTelemetry

A biblioteca suporta integração com OpenTelemetry através de injeção de dependência. Para usar, você precisa:

1. Instalar as dependências do OpenTelemetry:

```bash
npm install @opentelemetry/api @opentelemetry/sdk-node @opentelemetry/exporter-jaeger @opentelemetry/resources @opentelemetry/semantic-conventions @opentelemetry/sdk-trace-base
```

2. Configurar o OpenTelemetry e injetar o tracer:

```typescript
import { trace } from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { JaegerExporter } from "@opentelemetry/exporter-jaeger";
import { Resource } from "@opentelemetry/resources";
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions";
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";

// Configurar o OpenTelemetry
const jaegerExporter = new JaegerExporter({
  endpoint: "http://localhost:14268/api/traces",
});

const sdk = new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: "pipeline-service",
  }),
  spanProcessor: new SimpleSpanProcessor(jaegerExporter),
});

await sdk.start();
const tracer = trace.getTracer("pipeline-core");

// Configurar o monitoramento da pipeline
const monitoringConfig = {
  telemetry: {
    enabled: true,
    tracer,
  },
  // ... outras configurações de monitoramento
};

pipeline.configureMonitoring(monitoringConfig);
```

A biblioteca irá automaticamente criar spans para cada etapa da pipeline, permitindo que você visualize o fluxo de execução no Jaeger ou em qualquer outro coletor de traces compatível com OpenTelemetry.

## Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) before submitting a pull request.

## License

MIT

## Support

For support, please open an issue in the GitHub repository or contact the maintainers.
