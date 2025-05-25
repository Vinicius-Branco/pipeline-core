export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  backoffMs: number
): Promise<T> {
  let attempt = 0;

  while (attempt <= maxRetries) {
    try {
      return await fn();
    } catch (error: unknown) {
      if (attempt === maxRetries) throw error;

      const jitter = Math.random() * 0.1 * backoffMs; // 10% de jitter
      const delay = backoffMs * Math.pow(2, attempt) + jitter; // backoff exponencial

      await new Promise((r) => setTimeout(r, delay));
      attempt++;
    }
  }

  throw new Error("Unexpected end of retry loop");
}
