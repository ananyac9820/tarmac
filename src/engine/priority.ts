/**
 * Algorithm 5 — Emergency preemption with aging.
 *
 *   priority(routine)   = agingRate * minutesWaitedSinceReady
 *   priority(emergency) = emergencyBasePriority            (constant, FIFO among emergencies)
 *
 * "Ready" for a routine patient = max(arrival, own slot start), so arriving
 * early earns nothing and booking order is preserved among on-time patients.
 *
 * An emergency beats a routine patient only while the routine patient has
 * waited less than emergencyBasePriority / agingRate minutes. After that the
 * routine patient wins (ties go to the routine patient), so a continuous
 * stream of emergencies can never starve anyone:
 *
 *   headOfLineWait <= max(E / agingRate, lateGrace) + longest single consult
 *
 * That bound is asserted in tests/aging.test.ts.
 */
import type { Minutes } from './types';

export interface PriorityInput {
  kind: 'ROUTINE' | 'EMERGENCY';
  readyAt: Minutes;
  slotIndex: number; // routine only; emergencies use -1
  arrivedAt: Minutes;
  id: string;
}

export function priorityOf(p: PriorityInput, now: Minutes, agingRate: number, emergencyBase: number): number {
  if (p.kind === 'EMERGENCY') return emergencyBase;
  return agingRate * Math.max(0, now - p.readyAt);
}

/** Total, deterministic ordering: higher priority first; ties -> routine, slot index, arrival, id. */
export function comparePriority(
  a: PriorityInput,
  b: PriorityInput,
  now: Minutes,
  agingRate: number,
  emergencyBase: number,
): number {
  const pa = priorityOf(a, now, agingRate, emergencyBase);
  const pb = priorityOf(b, now, agingRate, emergencyBase);
  if (pa !== pb) return pb - pa;
  if (a.kind !== b.kind) return a.kind === 'ROUTINE' ? -1 : 1;
  if (a.kind === 'ROUTINE' && a.slotIndex !== b.slotIndex) return a.slotIndex - b.slotIndex;
  if (a.arrivedAt !== b.arrivedAt) return a.arrivedAt - b.arrivedAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
