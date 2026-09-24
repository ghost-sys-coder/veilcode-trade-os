type AsyncTask<Result = unknown> = () => PromiseLike<Result>;

type TaskResults<Tasks extends readonly AsyncTask[]> = {
  [Index in keyof Tasks]: Awaited<ReturnType<Tasks[Index]>>;
};

/**
 * Runs independent async work without creating an unbounded request burst.
 * Results retain the same tuple order as the supplied tasks.
 */
export async function runWithConcurrency<const Tasks extends readonly AsyncTask[]>(
  tasks: Tasks,
  concurrency: number,
): Promise<TaskResults<Tasks>> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError("Concurrency must be a positive integer.");
  }

  if (tasks.length === 0) return [] as unknown as TaskResults<Tasks>;

  const results: unknown[] = new Array(tasks.length);
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, tasks.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < tasks.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await tasks[index]();
    }
  }));

  return results as TaskResults<Tasks>;
}
