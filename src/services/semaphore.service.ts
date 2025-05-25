export class Semaphore {
  private tasks: Array<() => void> = [];
  private activeCount = 0;

  constructor(private readonly maxConcurrency: number) {
    if (maxConcurrency <= 0) {
      throw new Error("maxConcurrency must be greater than 0");
    }
  }

  async acquire(): Promise<void> {
    if (this.activeCount < this.maxConcurrency) {
      this.activeCount++;
      return;
    }

    return new Promise((resolve) => {
      this.tasks.push(() => {
        this.activeCount++;
        resolve();
      });
    });
  }

  release(): void {
    if (this.activeCount <= 0) {
      throw new Error("Semaphore released too many times");
    }

    this.activeCount--;

    if (this.tasks.length > 0) {
      const nextTask = this.tasks.shift();
      if (nextTask) {
        nextTask();
      }
    }
  }

  getCurrentConcurrency(): number {
    return this.activeCount;
  }
}
