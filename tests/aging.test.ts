/**
 * Emergency preemption with aging: repeated emergencies cannot starve
 * routine patients.
 *
 * Bound proven here: once a routine patient is at the head of the routine
 * line, they start within
 *     max(E / agingRate, lateGrace) + longestConsult
 * minutes, under ANY emergency arrival rate.
 */
import { describe, expect, it } from 'vitest';
import { comparePriority, generateClinicDay, runTarmac, withConfig, type ScenarioSpec } from '../src/engine';

function overloadScenario(emergencyRatePerHour: number): ScenarioSpec {
  return {
    date: '2026-11-26',
    doctors: [
      {
        id: 'D1',
        name: 'Dr. Test',
        specialty: 'Casualty',
        sessionStart: 540,
        sessionEnd: 780,
        callRatePerHour: 6,
        trueMedian: 8,
        trueSigma: 0.3,
        bookings: 24,
        takesEmergencies: true,
      },
    ],
    historicalVisitsPerDoctor: 300,
    noShowRate: 0,
    cancellationRate: 0,
    exchangeOptInRate: 0,
    constraintRate: 0,
    ignoresAdvisoryRate: 0,
    emergencyRatePerHour,
    emergencyDurationFactor: 1.6,
  };
}

function headWaits(run: ReturnType<typeof runTarmac>) {
  return run.patients
    .filter((p) => p.kind === 'ROUTINE' && p.headSince !== null)
    .map((p) => (p.consultStart ?? run.endedAt) - p.headSince!);
}

describe('Aging', () => {
  it('priority: a fresh emergency beats a routine patient, an aged routine patient beats an emergency', () => {
    const r = (readyAt: number) => ({ kind: 'ROUTINE' as const, readyAt, slotIndex: 0, arrivedAt: readyAt, id: 'R' });
    const e = { kind: 'EMERGENCY' as const, readyAt: 600, slotIndex: -1, arrivedAt: 600, id: 'E' };
    expect(comparePriority(e, r(590), 600, 1, 60)).toBeLessThan(0); // emergency first
    expect(comparePriority(r(530), e, 600, 1, 60)).toBeLessThan(0); // waited 70 >= 60 -> routine first
  });

  for (const rate of [2, 5, 8]) {
    it(`no routine patient waits beyond the bound at ${rate} emergencies/hour`, () => {
      const seed = 11;
      const cfg = withConfig({ seed, agingRatePerMinute: 1, emergencyBasePriority: 60, monteCarloSamples: 40, enableExchange: false });
      const run = runTarmac(generateClinicDay(seed, overloadScenario(rate)), cfg);
      const longest = Math.max(...run.patients.filter((p) => p.consultStart !== null).map((p) => p.consultEnd! - p.consultStart!));
      const bound = Math.max(cfg.emergencyBasePriority / cfg.agingRatePerMinute, cfg.lateGraceMinutes) + longest;
      const waits = headWaits(run);
      expect(waits.length).toBeGreaterThan(10);
      for (const w of waits) expect(w).toBeLessThanOrEqual(bound);
      // At 8/h the emergency work alone (~128 min/h) exceeds capacity, so the day
      // physically cannot finish; the bound above still holds for everyone who
      // reached the head of the line. Below capacity, everyone is seen.
      if (rate <= 5) expect(run.patients.filter((p) => p.status === 'UNSEEN')).toHaveLength(0);
    });
  }

  it('without aging, the same emergency load DOES starve routine patients (aging is doing the work)', () => {
    const seed = 11;
    const cfg = withConfig({ seed, agingRatePerMinute: 0, emergencyBasePriority: 60, monteCarloSamples: 40, enableExchange: false });
    const run = runTarmac(generateClinicDay(seed, overloadScenario(8)), cfg);
    const longest = Math.max(...run.patients.filter((p) => p.consultStart !== null).map((p) => p.consultEnd! - p.consultStart!));
    const bound = 60 + longest;
    expect(Math.max(...headWaits(run))).toBeGreaterThan(bound);
  });

  it('emergencies still preempt under normal load', () => {
    const run = runTarmac(generateClinicDay(5, overloadScenario(2)), withConfig({ seed: 5, monteCarloSamples: 40 }));
    expect(run.events.some((e) => e.type === 'EMERGENCY_PREEMPT')).toBe(true);
  });
});
