/**
 * Algorithm 4 — Slot Exchange (CDM slot substitution for patients).
 *
 * Under the FAA's Collaborative Decision Making programme, airlines may swap
 * slots among their own flights. TARMAC extends this to a clinic-mediated
 * exchange between PATIENTS: someone who would rather come later can hand
 * their slot to someone who would rather come earlier.
 *
 * Fairness invariants (enforced here and asserted in tests):
 *  1. Only patients who have opted in can ever be involved in a swap.
 *  2. A swap executes only if BOTH patients are strictly better off by their
 *     own stated preference, within their own stated max shift, and without
 *     violating any of their constraints. (Pareto improvement.)
 *  3. Nobody else's slot changes. A swap is a pure exchange of two slots;
 *     third parties are never touched.
 *  4. The patient moving earlier must be able to physically get there.
 *  5. A patient may appear in at most one swap per matching pass.
 */
import type { ExchangePreference, Minutes } from './types';

export interface ExchangeCandidate {
  patientId: string;
  slotIndex: number;
  slotStart: Minutes;
  /** The patient's ORIGINAL RBS slot start: max shift is measured from here. */
  originalSlotStart: Minutes;
  optIn: boolean;
  preference: ExchangePreference;
  maxShiftMinutes: Minutes;
  notBefore?: Minutes;
}

export interface ProposedSwap {
  /** Moves later (gets b's slot). */
  a: string;
  /** Moves earlier (gets a's slot). */
  b: string;
  aFrom: number;
  aTo: number;
  bFrom: number;
  bTo: number;
  aFromStart: Minutes;
  aToStart: Minutes;
  bFromStart: Minutes;
  bToStart: Minutes;
  reasonA: string;
  reasonB: string;
}

/** Does `c` strictly prefer a slot starting at `newStart` over its current one? */
export function prefers(c: ExchangeCandidate, newStart: Minutes): { better: boolean; reason: string } {
  if (!c.optIn) return { better: false, reason: 'not opted in' };
  if (newStart === c.slotStart) return { better: false, reason: 'no change' };
  if (c.notBefore !== undefined && newStart < c.notBefore) return { better: false, reason: 'violates constraint' };
  if (Math.abs(newStart - c.originalSlotStart) > c.maxShiftMinutes) return { better: false, reason: 'beyond max shift' };
  const currentlyViolates = c.notBefore !== undefined && c.slotStart < c.notBefore;
  if (currentlyViolates) return { better: true, reason: 'fixes "cannot arrive before" constraint' };
  if (c.preference === 'PREFER_EARLIER' && newStart < c.slotStart) return { better: true, reason: 'prefers earlier' };
  if (c.preference === 'PREFER_LATER' && newStart > c.slotStart) return { better: true, reason: 'prefers later' };
  return { better: false, reason: 'not in preferred direction' };
}

/**
 * Find a set of non-conflicting Pareto-improving swaps among one doctor's
 * queue. Deterministic: candidate pairs are ranked by (constraint fixes first,
 * then larger mutual benefit, then slot index) and selected greedily.
 *
 * @param canReachBy feasibility oracle for the patient moving earlier.
 */
export function findSwaps(
  candidates: readonly ExchangeCandidate[],
  canReachBy: (patientId: string, start: Minutes) => boolean,
): ProposedSwap[] {
  const pool = candidates.filter((c) => c.optIn).sort((x, y) => x.slotIndex - y.slotIndex);
  type Scored = ProposedSwap & { fixes: number; gain: number };
  const scored: Scored[] = [];
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const a = pool[i]; // earlier slot -> would move later
      const b = pool[j]; // later slot   -> would move earlier
      const pa = prefers(a, b.slotStart);
      if (!pa.better) continue;
      const pb = prefers(b, a.slotStart);
      if (!pb.better) continue;
      if (!canReachBy(b.patientId, a.slotStart)) continue;
      scored.push({
        a: a.patientId,
        b: b.patientId,
        aFrom: a.slotIndex,
        aTo: b.slotIndex,
        bFrom: b.slotIndex,
        bTo: a.slotIndex,
        aFromStart: a.slotStart,
        aToStart: b.slotStart,
        bFromStart: b.slotStart,
        bToStart: a.slotStart,
        reasonA: pa.reason,
        reasonB: pb.reason,
        fixes: (pa.reason.startsWith('fixes') ? 1 : 0) + (pb.reason.startsWith('fixes') ? 1 : 0),
        gain: b.slotStart - a.slotStart,
      });
    }
  }
  scored.sort((x, y) => y.fixes - x.fixes || y.gain - x.gain || x.aFrom - y.aFrom || x.bFrom - y.bFrom);
  const used = new Set<string>();
  const out: ProposedSwap[] = [];
  for (const s of scored) {
    if (used.has(s.a) || used.has(s.b)) continue;
    used.add(s.a);
    used.add(s.b);
    const { fixes: _f, gain: _g, ...swap } = s;
    out.push(swap);
  }
  return out;
}
