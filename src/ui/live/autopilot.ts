/**
 * Demo autopilot: plays the patients and/or doctors so the product views can
 * run unattended in a demo. Every human action is still available and wins.
 * Off by default on a real-clock day.
 */
import {
  ConsultationTimeModel,
  callNext,
  checkIn,
  finishCurrent,
  hashSeed,
  markOnTheWay,
  Rng,
  setDoctorPresent,
  vacate,
  type LiveState,
} from '../../engine';
import type { Autopilot } from './store';

/** Deterministic per-patient consult duration from the doctor's prior. */
function plannedConsult(live: LiveState, doctorId: string, patientId: string, kind: string): number {
  const d = live.doctors.find((x) => x.id === doctorId)!;
  const m = new ConsultationTimeModel(d.priorMu, d.priorSigma);
  const r = new Rng(hashSeed(42, patientId));
  return Math.max(2, Math.round(m.sample(r) * (kind === 'EMERGENCY' ? 1.6 : 1)));
}

export function autopilot(live: LiveState, now: number, ap: Autopilot) {
  if (ap.patients) {
    for (const p of live.patients) {
      if (p.status === 'BOOKED' && p.leaveNowAt !== null && now >= p.leaveNowAt + (hashSeed(7, p.id) % 4)) {
        // ~1 in 14 sample patients silently don't come — reception must mark them
        if (p.source === 'SAMPLE' && hashSeed(3, p.id) % 14 === 0) continue;
        markOnTheWay(live, p.id, now);
      }
      if (p.status === 'EN_ROUTE' && p.eta !== null && now >= p.eta) checkIn(live, p.id, now);
    }
  }
  if (ap.desk) {
    // Reception calls non-responders; after 10 more minutes of silence, marks them no-show.
    for (const p of live.patients) {
      if (p.status === 'BOOKED' && p.leaveNowAt !== null && now - p.leaveNowAt >= live.config.ackTimeoutMinutes + 10) vacate(live, p.id, 'NO_SHOW', now);
    }
  }
  if (ap.doctors) {
    for (const d of live.doctors) {
      if (!d.present && now >= d.sessionStart + d.delayMinutes) setDoctorPresent(live, d.id, true, now);
      if (!d.present) continue;
      if (d.currentId && d.currentStartedAt !== null) {
        const p = live.patients.find((x) => x.id === d.currentId)!;
        if (now - d.currentStartedAt >= plannedConsult(live, d.id, p.id, p.kind)) finishCurrent(live, d.id, now);
      }
      if (!d.currentId && (d.breakUntil === null || now >= d.breakUntil)) callNext(live, d.id, now);
    }
  }
}
