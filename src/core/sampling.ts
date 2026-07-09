import type { SessionFile } from "./types.js";

export interface SamplePlan {
  newest: SessionFile[];
  oldest: SessionFile[];
  middle: SessionFile[];
}

export const BUDGET = {
  newestCount: 15,
  oldestCount: 10,
  middleCount: 20,
  /** Max extracted message-lines the model may see per file. */
  maxLinesPerFile: 150,
  /** Hard cap on files read across an entire run. */
  maxFilesPerRun: 200,
} as const;

/**
 * The prompt's sampling spec, enforced in code: 15 newest + 10 oldest + 20
 * spread evenly across the middle. Overlap-free; small archives simply yield
 * fewer files.
 */
export function planSample(files: SessionFile[]): SamplePlan {
  const sorted = [...files].sort((a, b) => b.mtimeMs - a.mtimeMs); // newest first
  const newest = sorted.slice(0, BUDGET.newestCount);
  const afterNewest = sorted.slice(BUDGET.newestCount);
  const oldest = afterNewest.slice(-BUDGET.oldestCount);
  const middlePool = afterNewest.slice(0, Math.max(0, afterNewest.length - BUDGET.oldestCount));

  const middle: SessionFile[] = [];
  if (middlePool.length > 0) {
    const take = Math.min(BUDGET.middleCount, middlePool.length);
    for (let i = 0; i < take; i++) {
      const idx = Math.floor((i * middlePool.length) / take);
      middle.push(middlePool[idx]);
    }
  }
  return { newest, oldest, middle };
}
