import { describe, expect, it } from 'vitest';
import { compareRuns, demoScenario, runBaseline, runTarmac } from '../src/engine';

describe('scripted demo scenario', () => {
  const run = () => {
    const { day, config, commands } = demoScenario();
    return runTarmac(day, config, commands);
  };
  const r = run();
  const count = (type: string) => r.events.filter((e) => e.type === type).length;

  it('replays byte-identically', () => {
    expect(JSON.stringify(run().events)).toBe(JSON.stringify(r.events));
  });

  it('contains exactly the scripted story beats', () => {
    expect(count('DOCTOR_DELAY_ANNOUNCED')).toBe(1);
    expect(count('NO_SHOW_DECLARED')).toBe(2);
    expect(r.counters.slotsRecovered).toBe(2);
    expect(count('EMERGENCY_ARRIVED')).toBe(1);
    expect(count('SWAP')).toBe(2);
    expect(count('REVISED_ADVISORY')).toBeGreaterThan(0);
  });

  it('ends on a clear win over the baseline with the same events', () => {
    const { day, config, commands } = demoScenario();
    const c = compareRuns(42, runBaseline(day, config, commands), r);
    expect(c.meanTimeInClinicReductionPct).toBeGreaterThan(50);
  });
});
