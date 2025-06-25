import { Semaphore } from "../../../services/semaphore.service";

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
    it("should limit concurrent operations to maxConcurrency", async () => {
      const semaphore = new Semaphore(2);
      const activeOperations: number[] = [];
      const completedOperations: number[] = [];

      const operation = async (id: number) => {
        await semaphore.acquire();
        activeOperations.push(id);
        
        // Simulate work
        await new Promise(resolve => setTimeout(resolve, 100));
        
        activeOperations.splice(activeOperations.indexOf(id), 1);
        completedOperations.push(id);
        semaphore.release();
      };

      // Start 4 operations simultaneously
      const promises = [
        operation(1),
        operation(2),
        operation(3),
        operation(4)
      ];

      // Check that only 2 operations are active at any time
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(activeOperations.length).toBeLessThanOrEqual(2);

      await Promise.all(promises);
      expect(completedOperations).toEqual([1, 2, 3, 4]);
      expect(semaphore.getCurrentConcurrency()).toBe(0);
    });

    it("should maintain FIFO order for waiting operations", async () => {
      const semaphore = new Semaphore(1);
      const executionOrder: number[] = [];

      const operation = async (id: number) => {
        await semaphore.acquire();
        executionOrder.push(id);
        await new Promise(resolve => setTimeout(resolve, 50));
        semaphore.release();
      };

      // Start operations in order
      const promises = [
        operation(1),
        operation(2),
        operation(3)
      ];

      await Promise.all(promises);
      expect(executionOrder).toEqual([1, 2, 3]);
    });

    it("should handle rapid acquire/release cycles", async () => {
      const semaphore = new Semaphore(3);
      const operations: number[] = [];

      const operation = async (id: number) => {
        await semaphore.acquire();
        operations.push(id);
        semaphore.release();
      };

      const promises = Array.from({ length: 10 }, (_, i) => operation(i));
      await Promise.all(promises);

      expect(operations).toHaveLength(10);
      expect(semaphore.getCurrentConcurrency()).toBe(0);
    });
  });

  describe("Stress Testing", () => {
    it("should handle many concurrent operations", async () => {
      const semaphore = new Semaphore(5);
      const activeCount = { count: 0 };
      const maxActive = { count: 0 };
      const completed = { count: 0 };

      const operation = async () => {
        await semaphore.acquire();
        activeCount.count++;
        maxActive.count = Math.max(maxActive.count, activeCount.count);
        
        // Simulate variable work time
        await new Promise(resolve => setTimeout(resolve, Math.random() * 50));
        
        activeCount.count--;
        completed.count++;
        semaphore.release();
      };

      const promises = Array.from({ length: 20 }, () => operation());
      await Promise.all(promises);

      expect(completed.count).toBe(20);
      expect(maxActive.count).toBeLessThanOrEqual(5);
      expect(semaphore.getCurrentConcurrency()).toBe(0);
    });

    it("should handle operations with different durations", async () => {
      const semaphore = new Semaphore(2);
      const startTimes: number[] = [];
      const endTimes: number[] = [];

      const operation = async (id: number, duration: number) => {
        await semaphore.acquire();
        startTimes[id] = Date.now();
        
        await new Promise(resolve => setTimeout(resolve, duration));
        
        endTimes[id] = Date.now();
        semaphore.release();
      };

      const promises = [
        operation(0, 100), // Long operation
        operation(1, 50),  // Medium operation
        operation(2, 25),  // Short operation
        operation(3, 75)   // Medium operation
      ];

      await Promise.all(promises);

      // Verify all operations completed
      expect(startTimes).toHaveLength(4);
      expect(endTimes).toHaveLength(4);
      expect(semaphore.getCurrentConcurrency()).toBe(0);
    });
  });

  describe("Error Scenarios", () => {
    it("should handle errors during operations", async () => {
      const semaphore = new Semaphore(2);
      const completed: number[] = [];

      const operation = async (id: number, shouldFail: boolean) => {
        await semaphore.acquire();
        try {
          if (shouldFail) {
            throw new Error(`Operation ${id} failed`);
          }
          await new Promise(resolve => setTimeout(resolve, 50));
          completed.push(id);
        } finally {
          semaphore.release();
        }
      };

      const promises = [
        operation(1, false),
        operation(2, true),
        operation(3, false)
      ];

      await Promise.allSettled(promises);

      expect(completed).toEqual([1, 3]);
      expect(semaphore.getCurrentConcurrency()).toBe(0);
    });

    it("should maintain semaphore state after errors", async () => {
      const semaphore = new Semaphore(1);
      let errorThrown = false;

      const operation = async () => {
        await semaphore.acquire();
        try {
          throw new Error("Operation failed");
        } finally {
          semaphore.release();
          errorThrown = true;
        }
      };

      await expect(operation()).rejects.toThrow("Operation failed");
      expect(errorThrown).toBe(true);
      expect(semaphore.getCurrentConcurrency()).toBe(0);
    });
  });

  describe("Edge Cases", () => {
    it("should handle single concurrency limit", async () => {
      const semaphore = new Semaphore(1);
      const executionOrder: number[] = [];

      const operation = async (id: number) => {
        await semaphore.acquire();
        executionOrder.push(id);
        await new Promise(resolve => setTimeout(resolve, 50));
        semaphore.release();
      };

      const promises = Array.from({ length: 5 }, (_, i) => operation(i));
      await Promise.all(promises);

      expect(executionOrder).toEqual([0, 1, 2, 3, 4]);
    });

    it("should handle high concurrency limits", async () => {
      const semaphore = new Semaphore(100);
      const activeCount = { count: 0 };
      const maxActive = { count: 0 };

      const operation = async () => {
        await semaphore.acquire();
        activeCount.count++;
        maxActive.count = Math.max(maxActive.count, activeCount.count);
        
        await new Promise(resolve => setTimeout(resolve, 10));
        
        activeCount.count--;
        semaphore.release();
      };

      const promises = Array.from({ length: 50 }, () => operation());
      await Promise.all(promises);

      expect(maxActive.count).toBeLessThanOrEqual(100);
      expect(semaphore.getCurrentConcurrency()).toBe(0);
    });

    it("should handle zero timeout operations", async () => {
      const semaphore = new Semaphore(2);
      const completed: number[] = [];

      const operation = async (id: number) => {
        await semaphore.acquire();
        completed.push(id);
        semaphore.release();
      };

      const promises = Array.from({ length: 10 }, (_, i) => operation(i));
      await Promise.all(promises);

      expect(completed).toHaveLength(10);
      expect(semaphore.getCurrentConcurrency()).toBe(0);
    });
  });

  describe("Performance Characteristics", () => {
    it("should handle rapid acquire/release without blocking", async () => {
      const semaphore = new Semaphore(10);
      const startTime = Date.now();

      const operation = async () => {
        await semaphore.acquire();
        semaphore.release();
      };

      const promises = Array.from({ length: 1000 }, () => operation());
      await Promise.all(promises);

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete quickly (less than 1 second for 1000 operations)
      expect(duration).toBeLessThan(1000);
      expect(semaphore.getCurrentConcurrency()).toBe(0);
    });

    it("should maintain performance under load", async () => {
      const semaphore = new Semaphore(5);
      const startTime = Date.now();

      const operation = async () => {
        await semaphore.acquire();
        // Simulate some work
        await new Promise(resolve => setTimeout(resolve, 1));
        semaphore.release();
      };

      const promises = Array.from({ length: 100 }, () => operation());
      await Promise.all(promises);

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete within reasonable time
      expect(duration).toBeLessThan(5000);
      expect(semaphore.getCurrentConcurrency()).toBe(0);
    });
  });
}); 