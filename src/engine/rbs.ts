/**
 * Algorithm 1 — Ration By Schedule (RBS).
 *
 * In aviation, when an airport's capacity drops, the FAA allocates arrival
 * slots in the order flights were originally SCHEDULED. That order is a
 * property right: nobody loses their place because someone else is bigger or
 * louder. Here the original booking timestamp plays that role.
 *
 * Patients are ordered by booking timestamp (ties broken by id so the result
 * is total and deterministic) and assigned to slots spaced at the doctor's
 * declared call rate.
 */
import type { Doctor, Minutes, Patient, Slot } from './types';

export function slotLengthMinutes(callRatePerHour: number): Minutes {
  return 60 / callRatePerHour;
}

export function rbsOrder(patients: readonly Patient[]): Patient[] {
  return [...patients].sort((a, b) => a.bookedAt - b.bookedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function rationBySchedule(doctor: Doctor, patients: readonly Patient[]): Slot[] {
  const mine = rbsOrder(patients.filter((p) => p.doctorId === doctor.id));
  const len = slotLengthMinutes(doctor.callRatePerHour);
  return mine.map((p, index) => ({
    doctorId: doctor.id,
    index,
    scheduledStart: Math.round(doctor.sessionStart + index * len),
    patientId: p.id,
    state: 'ASSIGNED' as const,
  }));
}

/**
 * Re-time all not-yet-started slots after a call-rate change. The first
 * unstarted slot keeps its time; the rest are re-spaced at the new rate.
 */
export function retimeSlots(slots: Slot[], newCallRatePerHour: number): void {
  const k = slots.findIndex((s) => s.state === 'ASSIGNED' || s.state === 'VACATED');
  if (k < 0) return;
  const base = slots[k].scheduledStart;
  const len = slotLengthMinutes(newCallRatePerHour);
  for (let i = k; i < slots.length; i++) {
    if (slots[i].state === 'ASSIGNED' || slots[i].state === 'VACATED') {
      slots[i].scheduledStart = Math.round(base + (i - k) * len);
    }
  }
}
