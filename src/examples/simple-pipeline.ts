import { PipelineService } from "../services/pipeline.js";
import { PipelineConfig } from "../types/index.js";
import path from "path";
import { fileURLToPath } from "url";

// Define os passos da pipeline
type PipelineSteps = "step1" | "step2" | "step3";

// Configuração da pipeline
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

// Cria a instância da pipeline
const pipeline = new PipelineService<PipelineSteps, { value: number }>(config);

// Exemplo de uso
async function runPipeline() {
  try {
    // Inicia a pipeline do primeiro passo
    const result = await pipeline.execute([
      {
        data: { value: 1 },
        currentStep: "step1",
      },
    ]);

    console.log("Pipeline concluída:", result);

    // Exemplo de reprocessamento a partir de um passo específico
    const reprocessResult = await pipeline.execute({
      data: { value: 2 },
      currentStep: "step2", // Começa do passo 2
    });

    console.log("Reprocessamento concluído:", reprocessResult);
  } catch (error) {
    console.error("Erro na pipeline:", error);
  }
}

runPipeline();
