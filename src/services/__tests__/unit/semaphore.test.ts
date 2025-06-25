import { Semaphore } from "../../semaphore.service";

describe("Semaphore", () => {
  it("should block acquire when maxConcurrency is reached and resolve in FIFO order", async () => {
    const sem = new Semaphore(2);
    const results: number[] = [];

    await sem.acquire(); // 1 ativo
    await sem.acquire(); // 2 ativos

    // Próximos 3 ficam na fila
    const p1 = sem.acquire().then(() => results.push(1));
    const p2 = sem.acquire().then(() => results.push(2));
    const p3 = sem.acquire().then(() => results.push(3));

    // Libera 1 vaga
    sem.release();
    await p1;
    expect(results).toEqual([1]);

    // Libera mais 2 vagas
    sem.release();
    await p2;
    sem.release();
    await p3;
    expect(results).toEqual([1, 2, 3]);
  });

  it("should throw if release is called more times than acquire", () => {
    const sem = new Semaphore(1);
    expect(() => sem.release()).toThrow("Semaphore released too many times");
    sem.acquire();
    sem.release();
    expect(() => sem.release()).toThrow("Semaphore released too many times");
  });

  it("should execute tasks in FIFO order when multiple are waiting", async () => {
    const sem = new Semaphore(1);
    const order: number[] = [];

    await sem.acquire(); // 1 ativo
    const p1 = sem.acquire().then(() => order.push(1));
    const p2 = sem.acquire().then(() => order.push(2));
    const p3 = sem.acquire().then(() => order.push(3));

    sem.release(); // libera p1
    await p1;
    sem.release(); // libera p2
    await p2;
    sem.release(); // libera p3
    await p3;

    expect(order).toEqual([1, 2, 3]);
  });

  it("should return correct concurrency count during operations", async () => {
    const sem = new Semaphore(2);
    expect(sem.getCurrentConcurrency()).toBe(0);
    await sem.acquire();
    expect(sem.getCurrentConcurrency()).toBe(1);
    await sem.acquire();
    expect(sem.getCurrentConcurrency()).toBe(2);
    sem.release();
    expect(sem.getCurrentConcurrency()).toBe(1);
    sem.release();
    expect(sem.getCurrentConcurrency()).toBe(0);
  });

  it("should allow acquire/release interleaved and resolve correctly", async () => {
    const sem = new Semaphore(2);
    const log: string[] = [];
    await sem.acquire();
    log.push("A1");
    await sem.acquire();
    log.push("A2");
    const p = sem.acquire().then(() => log.push("A3"));
    sem.release();
    await p;
    expect(log).toEqual(["A1", "A2", "A3"]);
    sem.release();
    sem.release();
    expect(sem.getCurrentConcurrency()).toBe(0);
  });
}); 