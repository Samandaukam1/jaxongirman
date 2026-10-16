/**
 * Asking for many things in a few requests, without one bad answer costing all
 * of them.
 *
 * Items go out in batches of `size`. A batch that fails is split in half and
 * each half asked again, down to a single item; a batch answered only in part
 * is asked again for what it left out. What still has no answer after that is
 * simply absent from the result, for the caller to fill however it fills gaps.
 *
 * Pure and provider-free, so the rule can be tested without a model: the copy
 * writer passes a function that calls Gemini, a test passes one that refuses.
 */
export async function inBatches<T extends { index: number }, R>(input: {
  items: readonly T[];
  size: number;
  /** Answers a batch, keyed by item index. Throws when the request failed. */
  ask: (batch: T[], attempts: number) => Promise<Map<number, R>>;
  /** Told about every failed request, with the reason, before it is split. */
  failed?: (batch: T[], attempts: number, reason: string) => void;
  /** Attempts for the first request of each batch; the split is its own retry. */
  attempts?: number;
}): Promise<Map<number, R>> {
  const answers = new Map<number, R>();

  const ask = async (batch: T[], attempts: number): Promise<void> => {
    let got: Map<number, R>;
    try {
      got = await input.ask(batch, attempts);
      // An answer with nothing in it is a failure that did not throw.
      if (got.size === 0) throw new Error("empty answer");
    } catch (failure) {
      input.failed?.(batch, attempts, String((failure as Error)?.message ?? failure).slice(0, 240));
      if (batch.length === 1) return;
      const half = Math.ceil(batch.length / 2);
      await Promise.all([ask(batch.slice(0, half), 1), ask(batch.slice(half), 1)]);
      return;
    }
    for (const [index, value] of got) answers.set(index, value);
    const missing = batch.filter((item) => !got.has(item.index));
    // A short answer is asked again for the items it left out, by the same
    // rules. It always ends: every round asks for strictly fewer items than
    // the one before, and a single item that fails is given up on.
    if (missing.length) await ask(missing, 1);
  };

  const batches: T[][] = [];
  for (let start = 0; start < input.items.length; start += input.size) batches.push(input.items.slice(start, start + input.size));
  await Promise.all(batches.map((batch) => ask(batch, input.attempts ?? 1)));
  return answers;
}
