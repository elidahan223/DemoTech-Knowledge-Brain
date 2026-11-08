type Work = {
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};
const foreground: Work[] = [];
const background: Work[] = [];
let running = false;

async function drain() {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const work = foreground.shift() || background.shift();
      if (!work) break;
      try {
        work.resolve(await work.run());
      } catch (error) {
        work.reject(error);
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  } finally {
    running = false;
  }
}

/** One local inference at a time; queued chat/search work precedes background analysis. */
export function runLocalModel<T>(run: () => Promise<T>, lowPriority = false): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    (lowPriority ? background : foreground).push({
      run,
      resolve: (value) => resolve(value as T),
      reject,
    });
    void drain();
  });
}
