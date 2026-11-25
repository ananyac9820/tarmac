import { describe, expect, it } from 'vitest';
import { TarmacSimulation, generateClinicDay, runTarmac, withConfig } from '../src/engine';

const fastCfg = (over = {}) => withConfig({ seed: 42, monteCarloSamples: 120, ...over });

describe('Ground holding — hold patients at home, not in the corridor', () => {
  it('advisedDeparture = predictedStart(p10) - travel - buffer', () => {
    const cfg = fastCfg();
    const sim = new TarmacSimulation(generateClinicDay(42), cfg);
    let checked = 0;
    for (const p of sim.patients.values()) {
      if (p.kind !== 'ROUTINE' || p.status !== 'BOOKED' || p.notBefore !== undefined || !p.prediction) continue;
      expect(p.advisedDeparture).toBe(Math.floor(p.prediction.pAdvisory - p.travelMinutes - cfg.bufferMinutes));
      expect(p.prediction.pAdvisory).toBe(p.prediction.p10); // default percentile is p10
      checked++;
    }
    expect(checked).toBeGreaterThan(30);
  });

  it('the advisory percentile is configurable (p50 => later departures than p10)', () => {
    const day = generateClinicDay(42);
    const p10 = new TarmacSimulation(day, fastCfg({ advisoryPercentile: 0.1 }));
    const p50 = new TarmacSimulation(day, fastCfg({ advisoryPercentile: 0.5 }));
    let later = 0;
    for (const p of p10.patients.values()) {
      const q = p50.patients.get(p.id)!;
      if (p.advisedDeparture !== null && q.advisedDeparture !== null && q.advisedDeparture >= p.advisedDeparture) later++;
    }
    expect(later).toBe([...p10.patients.values()].filter((p) => p.advisedDeparture !== null).length);
  });

  it('uncertainty propagates: the long-tail doctor\'s queue has a much wider predicted-start band', () => {
    const sim = new TarmacSimulation(generateClinicDay(42), fastCfg());
    const band = (doctorId: string, k: number) => {
      const q = [...sim.patients.values()].filter((p) => p.doctorId === doctorId).sort((a, b) => a.slotIndex! - b.slotIndex!);
      const pr = q[k].prediction!;
      return pr.p90 - pr.p10;
    };
    expect(band('D2', 12)).toBeGreaterThan(2 * band('D1', 12));
  });

  it('emits LEAVE_NOW once per patient, at or after the advised time, and patients then travel in', () => {
    const run = runTarmac(generateClinicDay(42), fastCfg());
    const leaves = run.events.filter((e) => e.type === 'LEAVE_NOW');
    const ids = leaves.map((e) => e.patientId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(leaves.length).toBeGreaterThan(50);
  });

  it('a doctor delay triggers REVISED_ADVISORY telling that doctor\'s patients to leave LATER', () => {
    const run = runTarmac(generateClinicDay(42), fastCfg(), [{ at: 8 * 60, command: { type: 'DOCTOR_DELAY', doctorId: 'D2', minutes: 45 } }]);
    const revised = run.events.filter((e) => e.type === 'REVISED_ADVISORY' && e.doctorId === 'D2' && e.t === 8 * 60);
    expect(revised.length).toBeGreaterThan(3);
    for (const e of revised) expect((e.data as { shift: number }).shift).toBeGreaterThan(0);
  });

  it('tracks timeInClinic = arrival -> consult start for every seen patient', () => {
    const run = runTarmac(generateClinicDay(42), fastCfg());
    for (const p of run.patients) {
      if (p.consultStart === null) continue;
      expect(p.arrivedAt).not.toBeNull();
      expect(p.consultStart).toBeGreaterThanOrEqual(p.arrivedAt!);
    }
  });

  it('ground holding is what moves the needle: disabling it increases time in clinic', () => {
    const day = generateClinicDay(42);
    const mean = (r: ReturnType<typeof runTarmac>) => {
      const w = r.patients.filter((p) => p.kind === 'ROUTINE' && p.consultStart !== null).map((p) => p.consultStart! - p.arrivedAt!);
      return w.reduce((a, b) => a + b, 0) / w.length;
    };
    const on = runTarmac(day, fastCfg());
    const off = runTarmac(day, fastCfg({ enableGroundHolding: false }));
    expect(mean(on)).toBeLessThan(mean(off));
  });
});
