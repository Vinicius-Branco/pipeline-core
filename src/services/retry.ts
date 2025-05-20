export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  backoffMs: number
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= maxRetries) throw err;
      await new Promise((r) => setTimeout(r, backoffMs * (attempt + 1)));
      attempt++;
    }
  }
}
