import { describe, expect, it } from "vitest";
import { planSample } from "../src/core/sampling.js";
import type { SessionFile } from "../src/core/types.js";

function files(n: number): SessionFile[] {
  return Array.from({ length: n }, (_, i) => ({
    path: `/fake/session-${i}.jsonl`,
    sizeBytes: 1000,
    mtimeMs: 1_700_000_000_000 + i * 86_400_000, // one per day, ascending
  }));
}

describe("planSample", () => {
  it("splits a large archive 15/10/20 with no overlap", () => {
    const plan = planSample(files(100));
    expect(plan.newest).toHaveLength(15);
    expect(plan.oldest).toHaveLength(10);
    expect(plan.middle).toHaveLength(20);
    const all = [...plan.newest, ...plan.oldest, ...plan.middle].map((f) => f.path);
    expect(new Set(all).size).toBe(all.length);
  });

  it("newest really are newest, oldest really are oldest", () => {
    const plan = planSample(files(100));
    const newestMtimes = plan.newest.map((f) => f.mtimeMs);
    const oldestMtimes = plan.oldest.map((f) => f.mtimeMs);
    expect(Math.min(...newestMtimes)).toBeGreaterThan(Math.max(...oldestMtimes));
  });

  it("handles small archives without duplication", () => {
    const plan = planSample(files(8));
    const all = [...plan.newest, ...plan.oldest, ...plan.middle].map((f) => f.path);
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBeLessThanOrEqual(8);
  });

  it("handles an empty archive", () => {
    const plan = planSample([]);
    expect(plan.newest).toHaveLength(0);
    expect(plan.oldest).toHaveLength(0);
    expect(plan.middle).toHaveLength(0);
  });
});
