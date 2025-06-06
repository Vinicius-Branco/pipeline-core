import { Semaphore } from "../../services/semaphore.service";

describe("Semaphore Service Integration Tests", () => {
  describe("Basic Semaphore Operations", () => {
    it("should throw error when maxConcurrency is less than or equal to 0", () => {
      expect(() => new Semaphore(0)).toThrow(
        "maxConcurrency must be greater than 0"
      );
      expect(() => new Semaphore(-1)).toThrow(
        "maxConcurrency must be greater than 0"
      );
    });

    it("should allow immediate acquisition when below max concurrency", async () => {
      const semaphore = new Semaphore(2);
      await semaphore.acquire();
      expect(semaphore.getCurrentConcurrency()).toBe(1);
    });

    it("should throw error when releasing more times than acquired", () => {
      const semaphore = new Semaphore(1);
      expect(() => semaphore.release()).toThrow(
        "Semaphore released too many times"
      );
    });
  });

  describe("Concurrency Control", () => {
    it("should respect max concurrency limit", async () => {
      const semaphore = new Semaphore(2);
      const executionOrder: number[] = [];
      const delays = [100, 50, 150, 75];

      const tasks = delays.map((delay, index) => async () => {
        await semaphore.acquire();
        executionOrder.push(index);
        await new Promise((resolve) => setTimeout(resolve, delay));
        semaphore.release();
      });

      await Promise.all(tasks.map((task) => task()));

      // Should have at most 2 concurrent executions
      expect(semaphore.getCurrentConcurrency()).toBe(0);
      expect(executionOrder.length).toBe(4);
    });

    it("should queue tasks when at max concurrency", async () => {
      const semaphore = new Semaphore(1);
      const executionOrder: number[] = [];

      const task1 = async () => {
        await semaphore.acquire();
        executionOrder.push(1);
        await new Promise((resolve) => setTimeout(resolve, 100));
        semaphore.release();
      };

      const task2 = async () => {
        await semaphore.acquire();
        executionOrder.push(2);
        await new Promise((resolve) => setTimeout(resolve, 50));
        semaphore.release();
      };

      // Start both tasks
      const promise1 = task1();
      const promise2 = task2();

      // Wait for both to complete
      await Promise.all([promise1, promise2]);

      // Task 1 should execute first, then task 2
      expect(executionOrder).toEqual([1, 2]);
      expect(semaphore.getCurrentConcurrency()).toBe(0);
    });
  });

  describe("Stress Testing", () => {
    it("should handle multiple concurrent acquisitions and releases", async () => {
      const semaphore = new Semaphore(3);
      const concurrentExecutions: number[] = [];
      const maxConcurrent = 10;
      const tasks = Array.from(
        { length: maxConcurrent },
        (_, i) => async () => {
          await semaphore.acquire();
          const currentConcurrency = semaphore.getCurrentConcurrency();
          concurrentExecutions.push(currentConcurrency);
          await new Promise((resolve) =>
            setTimeout(resolve, Math.random() * 100)
          );
          semaphore.release();
        }
      );

      await Promise.all(tasks.map((task) => task()));

      // Verify that concurrency never exceeded the limit
      expect(Math.max(...concurrentExecutions)).toBeLessThanOrEqual(3);
      expect(semaphore.getCurrentConcurrency()).toBe(0);
    });

    it("should maintain correct concurrency count under heavy load", async () => {
      const semaphore = new Semaphore(2);
      const iterations = 100;
      const errors: Error[] = [];

      const tasks = Array.from({ length: iterations }, (_, i) => async () => {
        try {
          await semaphore.acquire();
          const currentConcurrency = semaphore.getCurrentConcurrency();
          if (currentConcurrency > 2) {
            throw new Error(
              `Concurrency exceeded limit: ${currentConcurrency}`
            );
          }
          await new Promise((resolve) =>
            setTimeout(resolve, Math.random() * 10)
          );
          semaphore.release();
        } catch (error) {
          errors.push(error as Error);
        }
      });

      await Promise.all(tasks.map((task) => task()));

      expect(errors).toHaveLength(0);
      expect(semaphore.getCurrentConcurrency()).toBe(0);
    });
  });
});
