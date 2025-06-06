import { retryWithBackoff } from "../../services/retry.service";

describe("Retry Service Integration Tests", () => {
  describe("Successful Retries", () => {
    it("should succeed on first attempt", async () => {
      const mockFn = jest.fn().mockResolvedValue("success");
      const result = await retryWithBackoff(mockFn, 3, 100);

      expect(result).toBe("success");
      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    it("should succeed after some retries", async () => {
      const mockFn = jest
        .fn()
        .mockRejectedValueOnce(new Error("First failure"))
        .mockRejectedValueOnce(new Error("Second failure"))
        .mockResolvedValue("success");

      const result = await retryWithBackoff(mockFn, 3, 100);

      expect(result).toBe("success");
      expect(mockFn).toHaveBeenCalledTimes(3);
    });
  });

  describe("Failed Retries", () => {
    it("should throw error after max retries", async () => {
      const error = new Error("Persistent error");
      const mockFn = jest.fn().mockRejectedValue(error);

      await expect(retryWithBackoff(mockFn, 2, 100)).rejects.toThrow(
        "Persistent error"
      );
      expect(mockFn).toHaveBeenCalledTimes(3); // Initial attempt + 2 retries
    });

    it("should respect max retries limit", async () => {
      const mockFn = jest.fn().mockRejectedValue(new Error("Test error"));

      await expect(retryWithBackoff(mockFn, 1, 100)).rejects.toThrow(
        "Test error"
      );
      expect(mockFn).toHaveBeenCalledTimes(2); // Initial attempt + 1 retry
    });
  });

  describe("Backoff Behavior", () => {
    it("should implement exponential backoff with jitter", async () => {
      const mockFn = jest
        .fn()
        .mockRejectedValueOnce(new Error("First failure"))
        .mockRejectedValueOnce(new Error("Second failure"))
        .mockResolvedValue("success");

      const startTime = Date.now();
      await retryWithBackoff(mockFn, 3, 100);
      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // With 100ms base delay and 2 retries:
      // First retry: ~100ms + jitter
      // Second retry: ~200ms + jitter
      // Total should be at least 300ms
      expect(totalTime).toBeGreaterThanOrEqual(300);
      expect(mockFn).toHaveBeenCalledTimes(3);
    });
  });
});
