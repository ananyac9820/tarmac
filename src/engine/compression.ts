/**
 * Algorithm 3 — Compression (feasibility-constrained).
 *
 * In aviation, when a flight cancels, the next flight that can actually use
 * the slot is pulled up into it, then the slot it vacated is offered onward,
 * and so on: capacity is never wasted.
 *
 * The clinic twist that aviation doesn't have: a patient can only take an
 * earlier slot if they can PHYSICALLY get there in time
 * (now + travelTime <= newSlotStart). Patients already in the waiting room
 * have travel time 0 and are always feasible. Infeasible patients are skipped
 * but keep their own slot — they never lose their place.
 *
 * Compression only ever moves patients EARLIER, so it can never violate the
 * RBS property right.
 */
import type { Minutes, Slot } from './types';

export interface CompressionMove {
  patientId: string;
  fromIndex: number;
  toIndex: number;
  fromStart: Minutes;
  toStart: Minutes;
  minutesSaved: Minutes;
}

export interface CompressionResult {
  vacatedIndex: number;
  moves: CompressionMove[];
  /** True if the originally vacated slot was refilled. */
  recovered: boolean;
  /** Index of the slot left empty at the end of the chain (if any). */
  finalHoleIndex: number;
}

/**
 * @param slots     a single doctor's slots, ordered by index (mutated in place)
 * @param vacatedIndex index of the slot just vacated (state must be VACATED)
 * @param canTake   feasibility oracle: can this patient make a slot starting at `start`?
 * @param isMovable whether a patient may be moved at all (not in consult / done)
 */
export function compress(
  slots: Slot[],
  vacatedIndex: number,
  canTake: (patientId: string, start: Minutes) => boolean,
  isMovable: (patientId: string) => boolean = () => true,
): CompressionResult {
  const moves: CompressionMove[] = [];
  let hole = vacatedIndex;
  for (let j = vacatedIndex + 1; j < slots.length; j++) {
    const s = slots[j];
    if (s.state !== 'ASSIGNED' || s.patientId === null) continue;
    if (!isMovable(s.patientId)) continue;
    const target = slots[hole];
    if (!canTake(s.patientId, target.scheduledStart)) continue; // skipped, keeps own slot
    moves.push({
      patientId: s.patientId,
      fromIndex: j,
      toIndex: hole,
      fromStart: s.scheduledStart,
      toStart: target.scheduledStart,
      minutesSaved: s.scheduledStart - target.scheduledStart,
    });
    target.patientId = s.patientId;
    target.state = 'ASSIGNED';
    s.patientId = null;
    s.state = 'VACATED';
    hole = j;
  }
  return { vacatedIndex, moves, recovered: moves.length > 0, finalHoleIndex: hole };
}
