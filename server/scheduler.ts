// Interactive work (search, chat) has priority over background indexing on the shared local Ollama.
// Measured: Ollama embedding throughput is flat at ~40 ms/chunk for batch 8–64 and for 1–4 parallel requests,
// so background concurrency gains nothing and only delays queries queued behind a background batch.
let active = 0;
const waiters: (() => void)[] = [];
export function interactive<T>(work: () => Promise<T> | T): Promise<T> {
  active++;
  return Promise.resolve()
    .then(work)
    .finally(() => {
      active--;
      if (!active) for (const wake of waiters.splice(0)) wake();
    });
}
/** Resolves when no interactive request is running. Background jobs await this between units of work. */
export function interactiveIdle() {
  return active ? new Promise<void>((resolve) => waiters.push(resolve)) : Promise.resolve();
}
export function interactiveActive() {
  return active;
}
