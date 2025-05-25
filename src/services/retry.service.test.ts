import { retryWithBackoff } from "./retry.service";

describe("retryWithBackoff", () => {
  let originalRandom: () => number;
  let mockRandom: jest.Mock;

  beforeEach(() => {
    originalRandom = Math.random;
    mockRandom = jest.fn().mockReturnValue(0.5);
    Math.random = mockRandom;
  });

  afterEach(() => {
    Math.random = originalRandom;
  });

  it("should retry on error with exponential backoff", async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error("fail1"))
      .mockRejectedValueOnce(new Error("fail2"))
      .mockResolvedValueOnce("success");

    const result = await retryWithBackoff(fn, 3, 100);
    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(3);
  }, 10000);

  it("should throw after exceeding max retries", async () => {
    const fn = jest.fn().mockRejectedValue(new Error("fail always"));
    const promise = retryWithBackoff(fn, 2, 100);
    await expect(promise).rejects.toThrow("fail always");
    expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries
  }, 10000);

  it("should apply jitter to delay", async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error("fail1"))
      .mockResolvedValueOnce("success");

    const start = Date.now();
    await retryWithBackoff(fn, 1, 100);
    const duration = Date.now() - start;

    // With jitter of 0.5, delay should be between 100ms and 150ms
    expect(duration).toBeGreaterThanOrEqual(100);
    expect(duration).toBeLessThanOrEqual(150);
  }, 10000);

  it("should not retry on success", async () => {
    const fn = jest.fn().mockResolvedValue("success");
    const result = await retryWithBackoff(fn, 3, 100);
    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
