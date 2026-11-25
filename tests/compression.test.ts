import { describe, expect, it } from 'vitest';
import { compress, generateClinicDay, runTarmac, withConfig, type Slot } from '../src/engine';

function grid(ids: (string | null)[], start = 600, len = 10): Slot[] {
  return ids.map((id, index) => ({
    doctorId: 'D',
    index,
    scheduledStart: start + index * len,
    patientId: id,
    state: id === null ? 'VACATED' : 'ASSIGNED',
  }));
}

describe('Compression — feasibility-constrained', () => {
  // now = 09:50 (590). Slots at 10:00, 10:10, 10:20, 10:30, 10:40.
  const now = 590;
  const travel: Record<string, number> = { A: 0, B: 45, C: 5, D: 0 };
  const canTake = (id: string, start: number) => now + travel[id] <= Math.max(start, now);

  it('pulls the next FEASIBLE patient up and skips infeasible ones without losing their place', () => {
    const slots = grid([null, 'B', 'C', 'D', 'A']); // slot 0 vacated
    const res = compress(slots, 0, canTake);
    // B (45 min away) cannot make 10:00 -> skipped, stays at #1.
    expect(slots[1].patientId).toBe('B');
    // C (5 min) can make 10:00
    expect(slots[0].patientId).toBe('C');
    // then C's old slot #2 is offered on: D (in waiting room) takes it
    expect(slots[2].patientId).toBe('D');
    // then D's old #3 -> A (waiting room)
    expect(slots[3].patientId).toBe('A');
    expect(slots[4].state).toBe('VACATED');
    expect(res.recovered).toBe(true);
    expect(res.moves.map((m) => m.patientId)).toEqual(['C', 'D', 'A']);
    expect(res.moves.every((m) => m.minutesSaved > 0)).toBe(true);
    expect(res.moves.find((m) => m.patientId === 'C')).toMatchObject({ toIndex: 0, minutesSaved: 20 });
  });

  it('never moves anyone later, and every move satisfies now + travel <= newSlotStart', () => {
    const slots = grid([null, 'B', 'C', 'D', 'A']);
    const res = compress(slots, 0, canTake);
    for (const m of res.moves) {
      expect(m.toIndex).toBeLessThan(m.fromIndex);
      expect(now + travel[m.patientId]).toBeLessThanOrEqual(Math.max(m.toStart, now));
    }
  });

  it('waiting-room patients (travel 0) are always feasible, even for a slot already in the past', () => {
    const late = 700; // 11:40, all slots in the past
    const slots = grid([null, 'B', 'D']);
    compress(slots, 0, (id, s) => late + travel[id] <= Math.max(s, late));
    expect(slots[0].patientId).toBe('D');
    expect(slots[1].patientId).toBe('B');
  });

  it('leaves the hole if nobody can make it', () => {
    const slots = grid([null, 'B']);
    const res = compress(slots, 0, () => false);
    expect(res.recovered).toBe(false);
    expect(slots[0].state).toBe('VACATED');
    expect(slots[1].patientId).toBe('B');
  });

  it('in full simulation, compression recovers capacity and every logged move was feasible & earlier', () => {
    const run = runTarmac(generateClinicDay(42), withConfig({ seed: 42, monteCarloSamples: 60 }));
    const moves = run.events.filter((e) => e.type === 'COMPRESSION' && e.data?.filledBy);
    expect(moves.length).toBeGreaterThan(0);
    expect(run.counters.slotsRecovered).toBeGreaterThan(0);
    for (const e of moves) {
      const d = e.data as { minutesSaved: number; fromIndex: number; toIndex: number; vacatedSlot: number; filledBy: string };
      expect(d.minutesSaved).toBeGreaterThan(0);
      expect(d.toIndex).toBeLessThan(d.fromIndex);
    }
  });

  it('disabling compression wastes more doctor time on no-show holes', () => {
    const day = generateClinicDay(42);
    const on = runTarmac(day, withConfig({ seed: 42, monteCarloSamples: 60 }));
    const off = runTarmac(day, withConfig({ seed: 42, monteCarloSamples: 60, enableCompression: false }));
    const waste = (r: typeof on) => r.doctors.reduce((a, d) => a + d.idleNoShowMinutes, 0);
    expect(waste(off)).toBeGreaterThan(waste(on));
    expect(off.counters.slotsRecovered).toBe(0);
  });
});
