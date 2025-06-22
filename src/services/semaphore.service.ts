export class Semaphore {
  private tasks: Array<() => void> = [];
  private activeCount = 0;
  private isShutdown = false;
  private shutdownPromise: Promise<void> | null = null;
  private shutdownResolve: (() => void) | null = null;
  private shutdownResolved = false;

  constructor(private readonly maxConcurrency: number) {
    if (maxConcurrency <= 0) {
      throw new Error("maxConcurrency must be greater than 0");
    }
  }

  async acquire(): Promise<void> {
    if (this.isShutdown) {
      throw new Error("Semaphore is shutdown");
    }

    if (this.activeCount < this.maxConcurrency) {
      this.activeCount++;
      return;
    }

    return new Promise((resolve, reject) => {
      if (this.isShutdown) {
        reject(new Error("Semaphore is shutdown"));
        return;
      }

      this.tasks.push(() => {
        if (this.isShutdown) {
          reject(new Error("Semaphore is shutdown"));
          return;
        }
        this.activeCount++;
        resolve();
      });
    });
  }

  release(): void {
    if (this.activeCount <= 0) {
      if (this.isShutdown) {
        return;
      }
      throw new Error("Semaphore released too many times");
    }

    this.activeCount--;

    if (this.tasks.length > 0) {
      const nextTask = this.tasks.shift();
      if (nextTask) {
        nextTask();
      }
    }

    // Check if shutdown is complete
    if (
      this.isShutdown &&
      this.activeCount === 0 &&
      this.tasks.length === 0 &&
      this.shutdownResolve &&
      !this.shutdownResolved
    ) {
      this.shutdownResolved = true;
      this.shutdownResolve();
    }
  }

  getCurrentConcurrency(): number {
    return this.activeCount;
  }

  getPendingTasks(): number {
    return this.tasks.length;
  }

  isShutdownState(): boolean {
    return this.isShutdown;
  }

  async shutdown(timeout?: number): Promise<void> {
    if (this.isShutdown) {
      if (this.shutdownPromise) return this.shutdownPromise;
      return;
    }

    this.isShutdown = true;

    // If no active tasks and no pending tasks, shutdown immediately
    if (this.activeCount === 0 && this.tasks.length === 0) {
      this.shutdownResolved = true;
      return;
    }

    // Create shutdown promise
    this.shutdownPromise = new Promise<void>((resolve) => {
      this.shutdownResolve = () => {
        this.shutdownResolved = true;
        resolve();
      };
    });

    // Apply timeout if specified
    if (timeout) {
      const timeoutPromise = new Promise<void>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Semaphore shutdown timeout after ${timeout}ms`));
        }, timeout);
      });

      return Promise.race([this.shutdownPromise, timeoutPromise]);
    }

    return this.shutdownPromise;
  }

  async waitForPendingTasks(): Promise<void> {
    if (!this.isShutdown) {
      return;
    }

    if (this.activeCount === 0 && this.tasks.length === 0) {
      return;
    }

    return this.shutdownPromise || Promise.resolve();
  }

  forceShutdown(): void {
    this.isShutdown = true;
    this.tasks = [];
    this.activeCount = 0;
    if (this.shutdownResolve && !this.shutdownResolved) {
      this.shutdownResolved = true;
      this.shutdownResolve();
    }
  }
}
