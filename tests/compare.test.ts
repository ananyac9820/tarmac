import { describe, expect, it } from 'vitest';
import { compare, generateClinicDay, runBaseline, withConfig } from '../src/engine';

describe('Baseline vs TARMAC comparison', () => {
  const c = compare(42);

  it('runs end to end and both policies see the same patients', () => {
    expect(c.baseline.routinePatientsSeen).toBeGreaterThan(50);
    expect(c.tarmac.routinePatientsSeen).toBe(c.baseline.routinePatientsSeen);
    expect(c.tarmac.routinePatientsUnseen).toBe(0);
    expect(c.headline).toMatch(/TARMAC cuts mean time-in-clinic/);
  });

  it('TARMAC substantially reduces mean, median and p90 time in clinic', () => {
    expect(c.tarmac.meanTimeInClinic).toBeLessThan(c.baseline.meanTimeInClinic * 0.5);
    expect(c.tarmac.medianTimeInClinic).toBeLessThan(c.baseline.medianTimeInClinic);
    expect(c.tarmac.p90TimeInClinic).toBeLessThan(c.baseline.p90TimeInClinic);
    expect(c.meanTimeInClinicReductionPct).toBeGreaterThan(50);
  });

  it('the baseline sends no advisories and does no compression or exchange', () => {
    expect(c.baseline.advisoriesSent).toBe(0);
    expect(c.baseline.slotsRecoveredByCompression).toBe(0);
    expect(c.baseline.swapsExecuted).toBe(0);
    expect(c.tarmac.advisoriesSent).toBeGreaterThan(0);
    expect(c.tarmac.slotsRecoveredByCompression).toBeGreaterThan(0);
    expect(c.tarmac.swapsExecuted).toBeGreaterThan(0);
  });

  it('baseline uses the identical seeded patient stream (same consult durations)', () => {
    const day = generateClinicDay(42);
    const b = runBaseline(day, withConfig({ seed: 42 }));
    for (const p of b.patients) {
      if (p.kind !== 'ROUTINE' || p.consultStart === null) continue;
      expect(p.consultEnd! - p.consultStart).toBe(day.patients.find((q) => q.id === p.id)!.truth.consultMinutes);
    }
  });

  it('the improvement holds across seeds, not just the demo seed', () => {
    for (const seed of [1, 7, 2026]) {
      const r = compare(seed, { config: { monteCarloSamples: 80 } });
      expect(r.tarmac.meanTimeInClinic).toBeLessThan(r.baseline.meanTimeInClinic);
    }
  });
});
