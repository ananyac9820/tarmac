import { describe, expect, it } from 'vitest';
import { TarmacSimulation, generateClinicDay, rationBySchedule, runTarmac, withConfig, type Patient } from '../src/engine';

describe('Ration By Schedule — booking order is the property right', () => {
  const day = generateClinicDay(42);

  it('assigns slots strictly in booking-timestamp order, spaced at the declared call rate', () => {
    for (const d of day.doctors) {
      const slots = rationBySchedule(d, day.patients);
      const byId = new Map(day.patients.map((p) => [p.id, p]));
      for (let i = 1; i < slots.length; i++) {
        expect(byId.get(slots[i].patientId!)!.bookedAt).toBeGreaterThanOrEqual(byId.get(slots[i - 1].patientId!)!.bookedAt);
        expect(slots[i].scheduledStart).toBeGreaterThan(slots[i - 1].scheduledStart);
      }
      expect(slots[0].scheduledStart).toBe(d.sessionStart);
      const len = 60 / d.callRatePerHour;
      expect(slots[slots.length - 1].scheduledStart).toBe(Math.round(d.sessionStart + (slots.length - 1) * len));
    }
  });

  it('breaks booking-time ties deterministically by id', () => {
    const d = day.doctors[0];
    const base = day.patients.find((p) => p.doctorId === d.id)!;
    const twins: Patient[] = [
      { ...base, id: 'P902', bookedAt: -100 },
      { ...base, id: 'P901', bookedAt: -100 },
    ];
    expect(rationBySchedule(d, twins).map((s) => s.patientId)).toEqual(['P901', 'P902']);
  });

  it('INVARIANT over full days: a patient only ever moves to a LATER slot via a consented swap', () => {
    for (const seed of [1, 42, 99]) {
      const sim = new TarmacSimulation(generateClinicDay(seed), withConfig({ seed, monteCarloSamples: 60 }));
      // capture initial RBS assignment
      let prev = new Map([...sim.patients.values()].map((p) => [p.id, p.slotIndex]));
      let checked = 0;
      while (!sim.finished) {
        const evBefore = sim.events.length;
        sim.step();
        const stepEvents = sim.events.slice(evBefore);
        for (const p of sim.patients.values()) {
          const before = prev.get(p.id);
          if (before === undefined || before === null || p.slotIndex === null) continue;
          if (p.slotIndex > before) {
            // moved later: must be side "a" of a SWAP in this very step, with a stated reason
            const swap = stepEvents.find((e) => e.type === 'SWAP' && (e.data as { a: string }).a === p.id);
            expect(swap, `${p.id} moved later without a swap (seed ${seed})`).toBeDefined();
            expect(p.exchange.optIn).toBe(true);
            checked++;
          }
        }
        prev = new Map([...sim.patients.values()].map((p) => [p.id, p.slotIndex]));
      }
      expect(sim.finished).toBe(true);
      void checked;
    }
  });

  it('without exchange enabled, nobody EVER gets a later slot than RBS gave them', () => {
    const run = runTarmac(generateClinicDay(42), withConfig({ seed: 42, enableExchange: false, monteCarloSamples: 60 }));
    for (const p of run.patients) {
      if (p.kind !== 'ROUTINE' || p.slotIndex === null) continue;
      expect(p.slotIndex).toBeLessThanOrEqual(p.originalSlotIndex!);
    }
  });
});
