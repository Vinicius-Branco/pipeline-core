import { Semaphore } from "./semaphore.service";

describe("Semaphore", () => {
  describe("Basic functionality", () => {
    it("should initialize with correct max concurrency", () => {
      const semaphore = new Semaphore(5);
      expect(semaphore.getCurrentConcurrency()).toBe(0);
      expect(semaphore.getPendingTasks()).toBe(0);
      expect(semaphore.isShutdownState()).toBe(false);
    });

    it("should throw error for invalid max concurrency", () => {
      expect(() => new Semaphore(0)).toThrow(
        "maxConcurrency must be greater than 0"
      );
      expect(() => new Semaphore(-1)).toThrow(
        "maxConcurrency must be greater than 0"
      );
    });

    it("should allow immediate acquisition when under limit", async () => {
      const semaphore = new Semaphore(2);

      await semaphore.acquire();
      expect(semaphore.getCurrentConcurrency()).toBe(1);

      await semaphore.acquire();
      expect(semaphore.getCurrentConcurrency()).toBe(2);
    });

    it("should queue tasks when at max concurrency", async () => {
      const semaphore = new Semaphore(1);

      // First acquisition should succeed immediately
      await semaphore.acquire();
      expect(semaphore.getCurrentConcurrency()).toBe(1);

      // Second acquisition should be queued
      const secondAcquisition = semaphore.acquire();
      expect(semaphore.getPendingTasks()).toBe(1);

      // Release first acquisition
      semaphore.release();

      // Second acquisition should now succeed
      await secondAcquisition;
      expect(semaphore.getCurrentConcurrency()).toBe(1);
      expect(semaphore.getPendingTasks()).toBe(0);
    });

    it("should throw error when releasing too many times", () => {
      const semaphore = new Semaphore(1);
      expect(() => semaphore.release()).toThrow(
        "Semaphore released too many times"
      );
    });
  });

  describe("Shutdown functionality", () => {
    it("should reject new acquisitions when shutdown", async () => {
      const semaphore = new Semaphore(1);

      // Fill the semaphore
      const acquisition1 = semaphore.acquire();
      await acquisition1;

      // Start shutdown
      const shutdownPromise = semaphore.shutdown();

      // Try to acquire while shutting down
      await expect(semaphore.acquire()).rejects.toThrow(
        "Semaphore is shutdown"
      );

      // Release and complete shutdown
      semaphore.release();
      await shutdownPromise;
    });

    it("should wait for active acquisitions to complete", async () => {
      const semaphore = new Semaphore(1);

      // Acquire the semaphore
      const acquisition = semaphore.acquire();
      await acquisition;

      // Start shutdown
      const shutdownPromise = semaphore.shutdown();

      // Wait a bit to ensure shutdown is waiting
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(semaphore.isShutdownState()).toBe(true);

      // Release to complete shutdown
      semaphore.release();
      await shutdownPromise;
    });

    it("should timeout during shutdown", async () => {
      const semaphore = new Semaphore(1);

      // Acquire the semaphore
      const acquisition = semaphore.acquire();
      await acquisition;

      // Start shutdown with short timeout
      const startTime = Date.now();
      await expect(semaphore.shutdown(100)).rejects.toThrow(
        "Semaphore shutdown timeout after 100ms"
      );
      const endTime = Date.now();

      expect(endTime - startTime).toBeGreaterThanOrEqual(100);
      expect(endTime - startTime).toBeLessThan(200);

      // Clean up
      semaphore.release();
    });

    it("should handle multiple shutdown calls", async () => {
      const semaphore = new Semaphore(1);
      const shutdown1 = semaphore.shutdown();
      const shutdown2 = semaphore.shutdown();
      // Both should resolve without error
      await expect(shutdown1).resolves.toBeUndefined();
      await expect(shutdown2).resolves.toBeUndefined();
    });

    it("should handle shutdown with no active acquisitions", async () => {
      const semaphore = new Semaphore(2);

      const startTime = Date.now();
      await semaphore.shutdown();
      const endTime = Date.now();

      expect(endTime - startTime).toBeLessThan(100);
      expect(semaphore.isShutdownState()).toBe(true);
    });

    it("should handle release after shutdown", async () => {
      const semaphore = new Semaphore(1);
      // Acquire
      const acquisition = semaphore.acquire();
      await acquisition;
      // Start shutdown, but don't wait
      const shutdownPromise = semaphore.shutdown();
      // Release after shutdown should not throw error and not hang
      expect(() => semaphore.release()).not.toThrow();
      await shutdownPromise;
    });
  });

  describe("Edge cases", () => {
    it("should handle release after shutdown", async () => {
      const semaphore = new Semaphore(1);
      // Acquire
      const acquisition = semaphore.acquire();
      await acquisition;
      // Start shutdown, but don't wait
      const shutdownPromise = semaphore.shutdown();
      // Release after shutdown should not throw error and not hang
      expect(() => semaphore.release()).not.toThrow();
      await shutdownPromise;
    });
  });
});
