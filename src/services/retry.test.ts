import { retryWithBackoff } from "./retry";

describe("retryWithBackoff", () => {
  it("should resolve on first try if no error", async () => {
    const fn = jest.fn().mockResolvedValue("ok");
    await expect(retryWithBackoff(fn, 3, 10)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("should retry on error and eventually resolve", async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error("fail1"))
      .mockRejectedValueOnce(new Error("fail2"))
      .mockResolvedValue("success");
    await expect(retryWithBackoff(fn, 3, 10)).resolves.toBe("success");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("should throw after exceeding max retries", async () => {
    const fn = jest.fn().mockRejectedValue(new Error("fail always"));
    await expect(retryWithBackoff(fn, 2, 10)).rejects.toThrow("fail always");
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
