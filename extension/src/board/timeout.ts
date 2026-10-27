// Races a promise against a timer, so one hung job cannot hold up a queue forever. On
// timeout the returned promise rejects and `onTimeout` runs (to mark the job abandoned);
// whatever the job produces later is ignored. The timer is cleared as soon as the job ends.
export function withTimeout<T>(job: Promise<T>, ms: number, onTimeout?: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout?.();
      reject(new Error(`timed out after ${Math.round(ms / 1000)} s`));
    }, ms);
    job.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}
