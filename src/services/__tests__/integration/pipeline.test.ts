import { PipelineService } from "../../../services/pipeline.service";
import { PipelineConfig, PipelineEvent, ErrorActionType } from "../../../types";
import { MonitoringEvent } from "../../../types/monitoring";

describe("Pipeline Service Integration Tests", () => {
  let pipelineService: PipelineService<any>;

  afterEach(async () => {
    await pipelineService.cleanup();
  });

  describe("Basic Pipeline Execution", () => {
    beforeEach(() => {
      const config: PipelineConfig<"step1" | "step2" | "step3"> = {
        steps: [
          {
            name: "step1",
            handler: async (data: { value: number }) => ({
              ...data,
              value: data.value + 1,
              step1: true,
            }),
          },
          {
            name: "step2",
            handler: async (data: { value: number }) => ({
              ...data,
              value: data.value * 2,
              step2: true,
            }),
          },
          {
            name: "step3",
            handler: async (data: { value: number }) => ({
              ...data,
              value: data.value + 10,
              step3: true,
            }),
          },
        ],
        options: {
          maxConcurrentWorkers: 2,
          workerTimeout: 5000,
        },
      };

      pipelineService = new PipelineService(config);
    });

    it("should execute all steps in sequence", async () => {
      const input: PipelineEvent<"step1", { value: number }> = {
        currentStep: "step1",
        data: { value: 1 },
      };

      const result = await pipelineService.execute(input);
      // step1: 1 + 1 = 2, step2: 2 * 2 = 4, step3: 4 + 10 = 14
      expect(result).toEqual({
        value: 14,
        step1: true,
        step2: true,
        step3: true,
      });
    });

    it("should execute starting from middle step", async () => {
      const input: PipelineEvent<"step2", { value: number }> = {
        currentStep: "step2",
        data: { value: 5 },
      };

      const result = await pipelineService.execute(input);
      // step2: 5 * 2 = 10, step3: 10 + 10 = 20
      expect(result).toEqual({
        value: 20,
        step2: true,
        step3: true,
      });
    });

    it("should execute single step", async () => {
      const input: PipelineEvent<"step3", { value: number }> = {
        currentStep: "step3",
        data: { value: 10 },
      };

      const result = await pipelineService.execute(input);
      // step3: 10 + 10 = 20
      expect(result).toEqual({
        value: 20,
        step3: true,
      });
    });
  });

  describe("Error Handling and Continue", () => {
    beforeEach(() => {
      const config: PipelineConfig<"step1" | "errorStep" | "step2"> = {
        steps: [
          {
            name: "step1",
            handler: async (data: { value: number }) => ({
              ...data,
              value: data.value + 1,
            }),
          },
          {
            name: "errorStep",
            handler: async (_data: { value: number }) => {
              throw new Error("Step failed");
            },
            errorHandlers: {
              onError: async (error, context) => {
                return {
                  action: { type: ErrorActionType.CONTINUE, nextStep: "step2" },
                  newData: { ...context.data, value: context.data.value * 2 },
                };
              },
            },
          },
          {
            name: "step2",
            handler: async (data: { value: number }) => ({
              ...data,
              value: data.value * 2,
              step2: true,
            }),
          },
        ],
        options: {
          maxConcurrentWorkers: 1,
          workerTimeout: 5000,
        },
      };

      pipelineService = new PipelineService(config);
    });

    it("should detect infinite loops", async () => {
      const config: PipelineConfig<"errorStep"> = {
        steps: [
          {
            name: "errorStep",
            handler: async (_data: { value: number }) => {
              throw new Error("Step failed");
            },
            errorHandlers: {
              onError: async () => ({
                type: ErrorActionType.CONTINUE,
                nextStep: "errorStep", // Same step - should cause infinite loop
              }),
            },
          },
        ],
        options: {
          maxConcurrentWorkers: 1,
          workerTimeout: 5000,
        },
      };

      pipelineService = new PipelineService(config);

      const input: PipelineEvent<"errorStep", { value: number }> = {
        currentStep: "errorStep",
        data: { value: 5 },
      };

      await expect(pipelineService.execute(input)).rejects.toThrow(
        "Infinite loop detected"
      );
    });
  });

  describe("Array Input Processing", () => {
    beforeEach(() => {
      const config: PipelineConfig<"step1" | "step2"> = {
        steps: [
          {
            name: "step1",
            handler: async (data: { value: number }) => ({
              ...data,
              value: data.value + 1,
            }),
          },
          {
            name: "step2",
            handler: async (data: { value: number }) => ({
              ...data,
              value: data.value * 2,
            }),
          },
        ],
        options: {
          maxConcurrentWorkers: 2,
          workerTimeout: 5000,
        },
      };

      pipelineService = new PipelineService(config);
    });

    it("should process array of inputs in parallel", async () => {
      const inputs: PipelineEvent<"step1", { value: number }>[] = [
        { currentStep: "step1", data: { value: 1 } },
        { currentStep: "step1", data: { value: 2 } },
        { currentStep: "step1", data: { value: 3 } },
      ];

      const results = await pipelineService.execute(inputs);
      expect(results).toEqual([
        { value: 4 }, // (1+1)*2
        { value: 6 }, // (2+1)*2
        { value: 8 }, // (3+1)*2
      ]);
    });

    it("should handle mixed step inputs in array", async () => {
      const inputs: PipelineEvent<"step1" | "step2", { value: number }>[] = [
        { currentStep: "step1", data: { value: 1 } },
        { currentStep: "step2", data: { value: 5 } },
      ];

      const results = await pipelineService.execute(inputs);
      expect(results).toEqual([
        { value: 4 }, // (1+1)*2
        { value: 10 }, // 5*2
      ]);
    });
  });

  describe("Event Monitoring", () => {
    beforeEach(() => {
      const config: PipelineConfig<"step1" | "step2"> = {
        steps: [
          {
            name: "step1",
            handler: async (data: { value: number }) => ({
              ...data,
              value: data.value + 1,
            }),
          },
          {
            name: "step2",
            handler: async (data: { value: number }) => ({
              ...data,
              value: data.value * 2,
            }),
          },
        ],
        options: {
          maxConcurrentWorkers: 1,
          workerTimeout: 5000,
        },
      };

      pipelineService = new PipelineService(config);
    });

    it("should emit monitoring events during execution", async () => {
      const events: any[] = [];
      pipelineService.onEvent((event) => {
        events.push(event);
      });

      const input: PipelineEvent<"step1", { value: number }> = {
        currentStep: "step1",
        data: { value: 1 },
      };

      await pipelineService.execute(input);

      expect(events.length).toBeGreaterThan(0);
      expect(events.some(event => event.type === MonitoringEvent.STEP_END)).toBe(true);
      expect(events.some(event => event.step === "step1")).toBe(true);
      expect(events.some(event => event.step === "step2")).toBe(true);
    });

    it("should emit error events when steps fail", async () => {
      const config: PipelineConfig<"errorStep"> = {
        steps: [
          {
            name: "errorStep",
            handler: async (_data: { value: number }) => {
              throw new Error("Step failed");
            },
          },
        ],
        options: {
          maxConcurrentWorkers: 1,
          workerTimeout: 5000,
        },
      };

      pipelineService = new PipelineService(config);

      const events: any[] = [];
      pipelineService.onEvent((event) => {
        events.push(event);
      });

      const input: PipelineEvent<"errorStep", { value: number }> = {
        currentStep: "errorStep",
        data: { value: 1 },
      };

      await expect(pipelineService.execute(input)).rejects.toThrow("Step failed");

      expect(events.length).toBeGreaterThan(0);
      expect(events.some(event => event.type === MonitoringEvent.STEP_ERROR)).toBe(true);
    });
  });

  describe("Step Options and Configuration", () => {
    it("should use step-specific options", async () => {
      const config: PipelineConfig<"step1"> = {
        steps: [
          {
            name: "step1",
            handler: async (data: { value: number }) => ({
              ...data,
              value: data.value + 1,
            }),
            options: {
              maxConcurrentWorkers: 3,
              workerTimeout: 2000,
            },
          },
        ],
        options: {
          maxConcurrentWorkers: 1,
          workerTimeout: 5000,
        },
      };

      pipelineService = new PipelineService(config);

      const input: PipelineEvent<"step1", { value: number }> = {
        currentStep: "step1",
        data: { value: 1 },
      };

      const result = await pipelineService.execute(input);
      expect(result).toEqual({ value: 2 });
    });

    it("should merge retry strategies correctly", async () => {
      const config: PipelineConfig<"errorStep"> = {
        steps: [
          {
            name: "errorStep",
            handler: async (data: { value: number }) => {
              if (data.value < 2) {
                throw new Error("Temporary error");
              }
              return { ...data, processed: true };
            },
            options: {
              retryStrategy: {
                maxRetries: 2,
                backoffMs: 100,
              },
            },
            errorHandlers: {
              onError: async (error, context) => {
                // Increment the value on each retry to eventually succeed
                context.data.value += 1;
                return { type: ErrorActionType.RETRY };
              },
            },
          },
        ],
        options: {
          retryStrategy: {
            maxRetries: 1,
            backoffMs: 200,
          },
        },
      };

      pipelineService = new PipelineService(config);

      const input: PipelineEvent<"errorStep", { value: number }> = {
        currentStep: "errorStep",
        data: { value: 1 },
      };

      const result = await pipelineService.execute(input);
      expect(result).toEqual({ value: 2, processed: true });
    });
  });

  describe("Timeout Handling", () => {
    it("should respect step-specific timeout", async () => {
      const config: PipelineConfig<"slowStep"> = {
        steps: [
          {
            name: "slowStep",
            handler: async (data: { value: number }) => {
              await new Promise((resolve) => setTimeout(resolve, 200));
              return { ...data, value: data.value + 1 };
            },
            options: {
              workerTimeout: 100,
            },
          },
        ],
        options: {
          maxConcurrentWorkers: 1,
          workerTimeout: 5000,
        },
      };

      pipelineService = new PipelineService(config);

      const input: PipelineEvent<"slowStep", { value: number }> = {
        currentStep: "slowStep",
        data: { value: 1 },
      };

      await expect(pipelineService.execute(input)).rejects.toThrow("Worker timeout");
    });

    it("should use global timeout when step-specific is not provided", async () => {
      const config: PipelineConfig<"slowStep"> = {
        steps: [
          {
            name: "slowStep",
            handler: async (data: { value: number }) => {
              await new Promise((resolve) => setTimeout(resolve, 200));
              return { ...data, value: data.value + 1 };
            },
          },
        ],
        options: {
          maxConcurrentWorkers: 1,
          workerTimeout: 100,
        },
      };

      pipelineService = new PipelineService(config);

      const input: PipelineEvent<"slowStep", { value: number }> = {
        currentStep: "slowStep",
        data: { value: 1 },
      };

      await expect(pipelineService.execute(input)).rejects.toThrow("Worker timeout");
    });
  });
}); 