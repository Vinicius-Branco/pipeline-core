import { PipelineService } from "../services/pipeline.js";
import {
  PipelineConfig,
  ErrorAction,
  ErrorContext,
  ErrorActionType,
} from "../types/index.js";

// Define os passos da pipeline
type PipelineSteps =
  | "step1"
  | "step2"
  | "step3"
  | "errorHandler"
  | "deadLetter";

// Configuração da pipeline com handlers de erro integrados
const config: PipelineConfig<PipelineSteps> = {
  steps: [
    {
      name: "step1",
      handler: async (_data: { value: number }) => {
        console.log("Executando step1 com função");
        return Promise.reject(new Error("Erro no step1"));
        // return { ...data, value: data.value + 1 };
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
          console.log("Erro no step1:", error.message);
          return { type: ErrorActionType.RETRY, maxRetries: 2 };
        },
        onRetry: async (context: ErrorContext): Promise<void> => {
          console.log(`Tentativa ${context.retryCount} no step1`);
        },
      },
    },
    {
      name: "step2",
      handler: async (data: { value: number }) => {
        console.log("Executando step2 com função");
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
          console.log("Erro no step2:", error.message);
          return { type: ErrorActionType.CONTINUE, nextStep: "errorHandler" };
        },
        onContinue: async (_context: ErrorContext): Promise<void> => {
          console.log("Pulando para errorHandler após erro no step2");
        },
      },
    },
    {
      name: "step3",
      handler: async (data: { value: number }) => {
        console.log("Executando step3 com função");
        if (data.value > 5) {
          throw new Error("Valor muito alto!");
        }
        return { ...data, value: data.value * 2 };
      },
      errorHandlers: {
        onError: async (
          error: Error,
          _context: ErrorContext
        ): Promise<ErrorAction> => {
          console.log("Erro no step3:", error.message);
          return {
            type: ErrorActionType.CUSTOM,
            handler: async (
              _error: Error,
              _context: ErrorContext
            ): Promise<ErrorAction> => {
              console.log("Enviando para dead letter");
              return { type: ErrorActionType.STOP };
            },
          };
        },
        onStop: async (_context: ErrorContext): Promise<void> => {
          console.log("Pipeline parada após erro no step3");
        },
      },
    },
    {
      name: "errorHandler",
      handler: async (data: { value: number }) => {
        console.log("Executando errorHandler com função");
        return { ...data, value: data.value + 1 };
      },
      errorHandlers: {
        onError: async (
          error: Error,
          _context: ErrorContext
        ): Promise<ErrorAction> => {
          console.log("Erro no errorHandler:", error.message);
          return { type: ErrorActionType.STOP };
        },
      },
    },
    {
      name: "deadLetter",
      handler: async (data: { value: number }) => {
        console.log("Executando deadLetter com função");
        console.log("Dados rejeitados:", data);
        return data;
      },
      errorHandlers: {
        onError: async (
          error: Error,
          _context: ErrorContext
        ): Promise<ErrorAction> => {
          console.log("Erro no deadLetter:", error.message);
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

// Cria a instância da pipeline
const pipeline = new PipelineService<PipelineSteps, { value: number }>(config);

// Adiciona listener para eventos
pipeline.onEvent((event) => {
  switch (event.type) {
    case "ERROR":
      console.log(`Erro no passo ${event.step}:`, event.error.message);
      break;
    case "RETRY":
      console.log(
        `Tentativa ${event.context.retryCount} no passo ${event.step}`
      );
      break;
    case "STOP":
      console.log(`Pipeline parada no passo ${event.step}`);
      break;
  }
});

// Exemplo de uso
async function runPipeline() {
  try {
    const result = await pipeline.execute({
      data: { value: 1 },
      currentStep: "step1",
    });

    console.log("Pipeline concluída:", result);
  } catch (error) {
    console.error("Erro fatal na pipeline:", error);
  }
}

runPipeline();
