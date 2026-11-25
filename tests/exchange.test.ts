/**
 * "Can someone game the slot exchange?" — this file is the answer.
 *
 * Fairness invariants:
 *  1. Nobody who has not opted in is ever moved by the exchange.
 *  2. A swap only executes if BOTH parties are strictly better off by their
 *     own stated preference (Pareto improvement), within their own max shift.
 *  3. No third party's slot changes as a result of a swap.
 *  4. The patient moving earlier must physically be able to make it.
 *  5. No patient is in two swaps in one pass; no slot is double-booked.
 */
import { describe, expect, it } from 'vitest';
import {
  TarmacSimulation,
  findSwaps,
  generateClinicDay,
  prefers,
  withConfig,
  type ExchangeCandidate,
  type ProposedSwap,
} from '../src/engine';

const cand = (over: Partial<ExchangeCandidate> & { patientId: string; slotIndex: number }): ExchangeCandidate => ({
  slotStart: 540 + over.slotIndex * 10,
  originalSlotStart: 540 + over.slotIndex * 10,
  optIn: true,
  preference: 'NO_PREFERENCE',
  maxShiftMinutes: 120,
  ...over,
});
const always = () => true;

describe('Slot exchange — unit level', () => {
  it('swaps a "prefer later" patient with a "prefer earlier" patient', () => {
    const swaps = findSwaps(
      [cand({ patientId: 'A', slotIndex: 0, preference: 'PREFER_LATER' }), cand({ patientId: 'B', slotIndex: 5, preference: 'PREFER_EARLIER' })],
      always,
    );
    expect(swaps).toHaveLength(1);
    expect(swaps[0]).toMatchObject({ a: 'A', b: 'B', aTo: 5, bTo: 0 });
  });

  it('INVARIANT 1: never involves a patient who has not opted in', () => {
    const swaps = findSwaps(
      [
        cand({ patientId: 'A', slotIndex: 0, preference: 'PREFER_LATER', optIn: false }),
        cand({ patientId: 'B', slotIndex: 5, preference: 'PREFER_EARLIER' }),
      ],
      always,
    );
    expect(swaps).toHaveLength(0);
  });

  it('INVARIANT 2: one-sided wishes never execute (two "prefer earlier" patients cannot trade)', () => {
    const swaps = findSwaps(
      [cand({ patientId: 'A', slotIndex: 0, preference: 'PREFER_EARLIER' }), cand({ patientId: 'B', slotIndex: 5, preference: 'PREFER_EARLIER' })],
      always,
    );
    expect(swaps).toHaveLength(0);
  });

  it('INVARIANT 2: "no preference" patients are never moved — they gain nothing', () => {
    const swaps = findSwaps(
      [cand({ patientId: 'A', slotIndex: 0, preference: 'NO_PREFERENCE' }), cand({ patientId: 'B', slotIndex: 5, preference: 'PREFER_EARLIER' })],
      always,
    );
    expect(swaps).toHaveLength(0);
  });

  it('INVARIANT 2: respects each patient\'s own max shift', () => {
    const swaps = findSwaps(
      [
        cand({ patientId: 'A', slotIndex: 0, preference: 'PREFER_LATER', maxShiftMinutes: 20 }),
        cand({ patientId: 'B', slotIndex: 5, preference: 'PREFER_EARLIER' }),
      ],
      always,
    );
    expect(swaps).toHaveLength(0);
  });

  it('INVARIANT 2: a swap never violates a hard constraint, and fixing one counts as better', () => {
    // A cannot arrive before 09:30 but holds 09:00 -> any slot >= 09:30 is better for A.
    const a = cand({ patientId: 'A', slotIndex: 0, preference: 'NO_PREFERENCE', notBefore: 570 });
    expect(prefers(a, 560).better).toBe(false); // still violates
    expect(prefers(a, 580).better).toBe(true);
    const swaps = findSwaps([a, cand({ patientId: 'B', slotIndex: 4, preference: 'PREFER_EARLIER' })], always);
    expect(swaps).toHaveLength(1);
    expect(swaps[0].reasonA).toMatch(/constraint/);
  });

  it('INVARIANT 4: the patient moving earlier must be able to get there', () => {
    const swaps = findSwaps(
      [cand({ patientId: 'A', slotIndex: 0, preference: 'PREFER_LATER' }), cand({ patientId: 'B', slotIndex: 5, preference: 'PREFER_EARLIER' })],
      (id) => id !== 'B',
    );
    expect(swaps).toHaveLength(0);
  });

  it('INVARIANT 5: nobody appears in two swaps in one pass; output is deterministic', () => {
    const pool = [
      cand({ patientId: 'A', slotIndex: 0, preference: 'PREFER_LATER' }),
      cand({ patientId: 'B', slotIndex: 3, preference: 'PREFER_EARLIER' }),
      cand({ patientId: 'C', slotIndex: 6, preference: 'PREFER_EARLIER' }),
      cand({ patientId: 'D', slotIndex: 1, preference: 'PREFER_LATER' }),
    ];
    const s1 = findSwaps(pool, always);
    const ids = s1.flatMap((s) => [s.a, s.b]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(s1).toEqual(findSwaps([...pool].reverse(), always));
  });

  it('gaming attempt: lying about preference only ever moves the liar, never anyone else', () => {
    // M claims PREFER_EARLIER to try to jump the queue. Only a volunteer who
    // genuinely prefers later can give up their slot; bystanders are untouchable.
    const pool = [
      cand({ patientId: 'X1', slotIndex: 0, optIn: false }),
      cand({ patientId: 'X2', slotIndex: 1, preference: 'NO_PREFERENCE' }),
      cand({ patientId: 'M', slotIndex: 9, preference: 'PREFER_EARLIER' }),
    ];
    expect(findSwaps(pool, always)).toHaveLength(0);
  });
});

describe('Slot exchange — invariants over full simulated days', () => {
  for (const seed of [3, 42, 77]) {
    it(`seed ${seed}: every executed swap is Pareto-improving and touches nobody else`, () => {
      const sim = new TarmacSimulation(generateClinicDay(seed), withConfig({ seed, monteCarloSamples: 60 }));
      const snapshot = () => new Map([...sim.patients.values()].map((p) => [p.id, p.slotIndex]));
      let swapsSeen = sim.counters.swaps;
      while (!sim.finished) {
        const before = snapshot();
        const evBefore = sim.events.length;
        sim.step();
        const after = snapshot();
        const stepSwaps = sim.events.slice(evBefore).filter((e) => e.type === 'SWAP');
        const compressedIds = new Set(
          sim.events
            .slice(evBefore)
            .filter((e) => e.type === 'COMPRESSION' && e.patientId)
            .map((e) => e.patientId!),
        );
        const swapped = new Set<string>();
        for (const e of stepSwaps) {
          const s = e.data as unknown as ProposedSwap;
          const a = sim.patients.get(s.a)!;
          const b = sim.patients.get(s.b)!;
          // (1) both opted in
          expect(a.exchange.optIn && b.exchange.optIn).toBe(true);
          // (2) both strictly better by their own preference
          expect(s.aToStart).toBeGreaterThan(s.aFromStart);
          expect(s.bToStart).toBeLessThan(s.bFromStart);
          expect(a.exchange.preference === 'PREFER_LATER' || a.notBefore !== undefined).toBe(true);
          expect(b.exchange.preference === 'PREFER_EARLIER' || b.notBefore !== undefined).toBe(true);
          expect(Math.abs(s.aToStart - a.originalSlotStart!)).toBeLessThanOrEqual(a.exchange.maxShiftMinutes);
          expect(Math.abs(s.bToStart - b.originalSlotStart!)).toBeLessThanOrEqual(b.exchange.maxShiftMinutes);
          // (5) no double-participation in one pass
          expect(swapped.has(a.id) || swapped.has(b.id)).toBe(false);
          swapped.add(a.id);
          swapped.add(b.id);
        }
        // (3) third parties: anyone whose slot changed this step was a swap
        // party or was pulled EARLIER by compression — never moved later.
        for (const [id, idx] of after) {
          const prev = before.get(id);
          if (prev === undefined || prev === null || idx === null || prev === idx) continue;
          if (swapped.has(id)) continue;
          expect(compressedIds.has(id), `${id} moved without being a party`).toBe(true);
          expect(idx).toBeLessThan(prev);
        }
        swapsSeen = sim.counters.swaps;
      }
      // no slot double-booked at end of day
      for (const slots of Object.values(sim.slots)) {
        const held = slots.filter((s) => s.patientId).map((s) => s.patientId);
        expect(new Set(held).size).toBe(held.length);
      }
      expect(swapsSeen).toBeGreaterThan(0);
    });
  }
});
