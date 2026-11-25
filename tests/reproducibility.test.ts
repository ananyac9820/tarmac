import { describe, expect, it } from 'vitest';
import { Rng, compare, generateClinicDay, runBaseline, runTarmac, withConfig } from '../src/engine';

describe('determinism under a fixed seed', () => {
  it('the PRNG yields the same stream for the same seed and forks are stable', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const xs = Array.from({ length: 1000 }, () => a.next());
    const ys = Array.from({ length: 1000 }, () => b.next());
    expect(xs).toEqual(ys);
    expect(new Rng(42).fork('x').next()).toBe(new Rng(42).fork('x').next());
    expect(new Rng(42).fork('x').next()).not.toBe(new Rng(42).fork('y').next());
  });

  it('generates a byte-identical clinic day for the same seed', () => {
    expect(JSON.stringify(generateClinicDay(42))).toBe(JSON.stringify(generateClinicDay(42)));
    expect(JSON.stringify(generateClinicDay(42))).not.toBe(JSON.stringify(generateClinicDay(43)));
  });

  it('produces byte-identical TARMAC and baseline runs (full event log) for the same seed', () => {
    const cfg = withConfig({ seed: 42 });
    const r1 = runTarmac(generateClinicDay(42), cfg);
    const r2 = runTarmac(generateClinicDay(42), cfg);
    expect(JSON.stringify(r1.events)).toBe(JSON.stringify(r2.events));
    expect(JSON.stringify(r1.patients)).toBe(JSON.stringify(r2.patients));
    const b1 = runBaseline(generateClinicDay(42), cfg);
    const b2 = runBaseline(generateClinicDay(42), cfg);
    expect(JSON.stringify(b1.events)).toBe(JSON.stringify(b2.events));
  });

  it('compare(42) is byte-identical across calls', () => {
    expect(JSON.stringify(compare(42))).toBe(JSON.stringify(compare(42)));
  });

  it('the seed actually matters', () => {
    expect(JSON.stringify(compare(7).tarmac)).not.toBe(JSON.stringify(compare(42).tarmac));
  });
});
