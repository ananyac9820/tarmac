/**
 * LiveClinic — the same five ATC mechanisms, driven by REAL actions instead of
 * a simulated world.
 *
 * Patients book, tap "I'm leaving", get checked in; doctors call and finish;
 * reception marks no-shows and adds emergencies. Every action is timestamped,
 * so a day of use produces a real dataset: actual waits, and actual
 * consultation durations per doctor. Each doctor's consultation model
 * re-calibrates itself from those observed durations (prior + data).
 *
 * The state is a plain JSON object so it can be persisted and synced between
 * browser tabs (or, later, a server) without any class instances.
 * Functions here take the state and mutate it; callers clone first.
 */
import { compress } from './compression';
import { ConsultationTimeModel } from './consultation';
import { findSwaps, type ExchangeCandidate } from './exchange';
import { predictStarts, type QueueEntry, type StartPrediction } from './predict';
import { comparePriority, type PriorityInput } from './priority';
import { slotLengthMinutes } from './rbs';
import { Rng } from './rng';
import { fmtTime, type EngineEvent, type EventType, type ExchangePreference, type Minutes, type Slot } from './types';

export type LiveStatus = 'BOOKED' | 'EN_ROUTE' | 'WAITING' | 'IN_CONSULT' | 'DONE' | 'CANCELLED' | 'NO_SHOW';

export interface LivePatient {
  id: string;
  token: number;
  name: string;
  phone: string;
  doctorId: string;
  kind: 'ROUTINE' | 'EMERGENCY';
  source: 'APP' | 'DESK' | 'WALK_IN' | 'SAMPLE';
  bookedAt: number; // epoch ms — the RBS property right
  travelMinutes: Minutes;
  notBefore?: Minutes;
  optIn: boolean;
  preference: ExchangePreference;
  maxShiftMinutes: Minutes;
  slotIndex: number | null;
  originalSlotStart: Minutes | null;
  status: LiveStatus;
  advisedDeparture: Minutes | null;
  notifiedDeparture: Minutes | null;
  prediction: StartPrediction | null;
  leaveNowAt: Minutes | null;
  departedAt: Minutes | null;
  eta: Minutes | null;
  checkedInAt: Minutes | null;
  calledAt: Minutes | null;
  doneAt: Minutes | null;
}

export interface LiveDoctor {
  id: string;
  name: string;
  specialty: string;
  room: string;
  sessionStart: Minutes;
  sessionEnd: Minutes;
  callRatePerHour: number;
  /** Prior (from history) consult model: ln X ~ N(mu, sigma²). */
  priorMu: number;
  priorSigma: number;
  /** Real consultation durations observed today (minutes). */
  observed: number[];
  present: boolean;
  breakUntil: Minutes | null;
  /** Announced start delay before the doctor is in. */
  delayMinutes: Minutes;
  currentId: string | null;
  currentStartedAt: Minutes | null;
}

export interface LiveConfig {
  advisoryPercentile: number;
  bufferMinutes: Minutes;
  revisedThresholdMinutes: Minutes;
  earlyWindowMinutes: Minutes;
  lateGraceMinutes: Minutes;
  agingRatePerMinute: number;
  emergencyBasePriority: number;
  monteCarloSamples: number;
  /** Pseudo-observations the prior is worth when blending with real data. */
  priorWeight: number;
  ackTimeoutMinutes: Minutes;
}

export const LIVE_DEFAULTS: LiveConfig = {
  advisoryPercentile: 0.1,
  bufferMinutes: 5,
  revisedThresholdMinutes: 10,
  earlyWindowMinutes: 30,
  lateGraceMinutes: 10,
  agingRatePerMinute: 1,
  emergencyBasePriority: 60,
  monteCarloSamples: 150,
  priorWeight: 10,
  ackTimeoutMinutes: 15,
};

export interface LiveState {
  version: 1;
  clinicName: string;
  date: string;
  seq: number;
  nextToken: number;
  doctors: LiveDoctor[];
  slots: Record<string, Slot[]>;
  patients: LivePatient[];
  events: EngineEvent[];
  config: LiveConfig;
  lastRefresh: Minutes;
}

export interface DoctorSeed {
  id: string;
  name: string;
  specialty: string;
  room: string;
  sessionStart: Minutes;
  sessionEnd: Minutes;
  callRatePerHour: number;
  model: ConsultationTimeModel;
}

export function createLiveState(date: string, doctors: DoctorSeed[], clinicName = 'City OPD'): LiveState {
  return {
    version: 1,
    clinicName,
    date,
    seq: 0,
    nextToken: 1,
    doctors: doctors.map((d) => ({
      id: d.id,
      name: d.name,
      specialty: d.specialty,
      room: d.room,
      sessionStart: d.sessionStart,
      sessionEnd: d.sessionEnd,
      callRatePerHour: d.callRatePerHour,
      priorMu: d.model.mu,
      priorSigma: d.model.sigma,
      observed: [],
      present: false,
      breakUntil: null,
      delayMinutes: 0,
      currentId: null,
      currentStartedAt: null,
    })),
    slots: Object.fromEntries(doctors.map((d) => [d.id, []])),
    patients: [],
    events: [],
    config: { ...LIVE_DEFAULTS },
    lastRefresh: -Infinity,
  };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const PENDING: ReadonlySet<LiveStatus> = new Set(['BOOKED', 'EN_ROUTE', 'WAITING']);
export const isPending = (p: LivePatient) => PENDING.has(p.status);

function log(s: LiveState, t: Minutes, type: EventType, message: string, extra: Partial<EngineEvent> = {}) {
  s.events.push({ seq: s.seq++, t, type, message, ...extra });
  if (s.events.length > 3000) s.events.splice(0, s.events.length - 3000);
}

export function doctorOf(s: LiveState, id: string): LiveDoctor {
  const d = s.doctors.find((x) => x.id === id);
  if (!d) throw new Error(`unknown doctor ${id}`);
  return d;
}

export function patientOf(s: LiveState, id: string): LivePatient | undefined {
  return s.patients.find((p) => p.id === id);
}

export function slotStartOf(s: LiveState, p: LivePatient): Minutes | null {
  if (p.slotIndex === null) return null;
  return s.slots[p.doctorId][p.slotIndex]?.scheduledStart ?? null;
}

/**
 * The doctor's consultation model, calibrated on today's REAL visits:
 * a conjugate-style blend of the historical prior (worth `priorWeight`
 * pseudo-visits) and the observed log-durations.
 */
export function liveModel(d: LiveDoctor, priorWeight: number): ConsultationTimeModel {
  const n = d.observed.length;
  if (n === 0) return new ConsultationTimeModel(d.priorMu, d.priorSigma);
  const logs = d.observed.map((x) => Math.log(Math.max(1, x)));
  const mean = logs.reduce((a, b) => a + b, 0) / n;
  const ss = logs.reduce((a, b) => a + (b - mean) ** 2, 0);
  const w = priorWeight;
  const mu = (w * d.priorMu + n * mean) / (w + n);
  const variance = (w * d.priorSigma ** 2 + ss + ((w * n) / (w + n)) * (mean - d.priorMu) ** 2) / (w + n);
  return new ConsultationTimeModel(mu, Math.max(0.08, Math.sqrt(variance)), n);
}

function canMake(s: LiveState, p: LivePatient, start: Minutes, now: Minutes): boolean {
  const eff = Math.max(start, now);
  if (p.status === 'WAITING') return true;
  if (p.notBefore !== undefined && eff < p.notBefore) return false;
  if (p.status === 'EN_ROUTE') return (p.eta ?? Infinity) <= eff;
  if (p.status === 'BOOKED') return now + p.travelMinutes <= eff;
  return false;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export interface BookingInput {
  name: string;
  phone: string;
  doctorId: string;
  travelMinutes: number;
  notBefore?: Minutes;
  source?: LivePatient['source'];
  bookedAtMs: number;
  walkIn?: boolean;
}

/** Algorithm 1 (RBS) for a live clinic: a new booking takes the next slot in order. */
export function book(s: LiveState, input: BookingInput, now: Minutes): LivePatient {
  const d = doctorOf(s, input.doctorId);
  const slots = s.slots[d.id];
  const len = slotLengthMinutes(d.callRatePerHour);
  const index = slots.length;
  const prev = slots[index - 1]?.scheduledStart ?? -Infinity;
  const ready = input.walkIn ? now : now + input.travelMinutes;
  const start = Math.round(Math.max(d.sessionStart + index * len, prev + len, Math.ceil(ready / 5) * 5));
  const id = `T${String(s.nextToken).padStart(3, '0')}`;
  const p: LivePatient = {
    id,
    token: s.nextToken++,
    name: input.name.trim() || 'Patient',
    phone: input.phone.trim(),
    doctorId: d.id,
    kind: 'ROUTINE',
    source: input.walkIn ? 'WALK_IN' : (input.source ?? 'APP'),
    bookedAt: input.bookedAtMs,
    travelMinutes: input.walkIn ? 0 : Math.max(0, Math.round(input.travelMinutes)),
    notBefore: input.notBefore,
    optIn: false,
    preference: 'NO_PREFERENCE',
    maxShiftMinutes: 90,
    slotIndex: index,
    originalSlotStart: start,
    status: input.walkIn ? 'WAITING' : 'BOOKED',
    advisedDeparture: null,
    notifiedDeparture: null,
    prediction: null,
    leaveNowAt: null,
    departedAt: null,
    eta: null,
    checkedInAt: input.walkIn ? now : null,
    calledAt: null,
    doneAt: null,
  };
  slots.push({ doctorId: d.id, index, scheduledStart: start, patientId: id, state: 'ASSIGNED' });
  s.patients.push(p);
  log(s, now, 'BOOKED', `Token ${p.token} — ${p.name} booked with ${d.name}, slot ${fmtTime(start)}${input.walkIn ? ' (walk-in)' : ''}`, {
    patientId: id,
    doctorId: d.id,
  });
  return p;
}

export function addEmergency(s: LiveState, name: string, doctorId: string | null, now: Minutes): LivePatient {
  const d = doctorId ? doctorOf(s, doctorId) : pickEmergencyDoctor(s);
  const id = `E${String(s.nextToken).padStart(3, '0')}`;
  const p: LivePatient = {
    id,
    token: s.nextToken++,
    name: name.trim() || 'Emergency',
    phone: '',
    doctorId: d.id,
    kind: 'EMERGENCY',
    source: 'DESK',
    bookedAt: Date.now(),
    travelMinutes: 0,
    optIn: false,
    preference: 'NO_PREFERENCE',
    maxShiftMinutes: 0,
    slotIndex: null,
    originalSlotStart: null,
    status: 'WAITING',
    advisedDeparture: null,
    notifiedDeparture: null,
    prediction: null,
    leaveNowAt: null,
    departedAt: null,
    eta: null,
    checkedInAt: now,
    calledAt: null,
    doneAt: null,
  };
  s.patients.push(p);
  log(s, now, 'EMERGENCY_ARRIVED', `EMERGENCY: ${p.name} — routed to ${d.name}`, { patientId: id, doctorId: d.id });
  return p;
}

function pickEmergencyDoctor(s: LiveState): LiveDoctor {
  const load = (d: LiveDoctor) => s.patients.filter((p) => p.doctorId === d.id && (p.status === 'WAITING' || p.status === 'IN_CONSULT')).length;
  return s.doctors.reduce((best, d) => (load(d) < load(best) ? d : best), s.doctors[0]);
}

export function markOnTheWay(s: LiveState, id: string, now: Minutes) {
  const p = patientOf(s, id);
  if (!p || p.status !== 'BOOKED') return;
  p.status = 'EN_ROUTE';
  p.departedAt = now;
  p.eta = now + p.travelMinutes;
  log(s, now, 'DEPARTED', `${p.name} is on the way — ETA ${fmtTime(p.eta)}`, { patientId: id, doctorId: p.doctorId });
}

export function checkIn(s: LiveState, id: string, now: Minutes) {
  const p = patientOf(s, id);
  if (!p || (p.status !== 'BOOKED' && p.status !== 'EN_ROUTE')) return;
  p.status = 'WAITING';
  p.checkedInAt = now;
  log(s, now, 'CHECKED_IN', `Token ${p.token} — ${p.name} checked in`, { patientId: id, doctorId: p.doctorId });
}

export function setExchange(s: LiveState, id: string, optIn: boolean, preference: ExchangePreference, now: Minutes) {
  const p = patientOf(s, id);
  if (!p || p.kind !== 'ROUTINE') return;
  p.optIn = optIn;
  p.preference = optIn ? preference : 'NO_PREFERENCE';
  log(s, now, 'EXCHANGE_OPT_IN', optIn ? `${p.name} is open to a slot swap (${preference === 'PREFER_EARLIER' ? 'earlier' : 'later'})` : `${p.name} left the slot exchange`, {
    patientId: id,
    doctorId: p.doctorId,
  });
}

/** Cancel / no-show: free the slot and run Algorithm 3 (compression). */
export function vacate(s: LiveState, id: string, status: 'CANCELLED' | 'NO_SHOW', now: Minutes) {
  const p = patientOf(s, id);
  if (!p || !isPending(p)) return;
  p.status = status;
  log(s, now, status === 'CANCELLED' ? 'CANCELLED' : 'NO_SHOW_DECLARED', `Token ${p.token} — ${p.name} ${status === 'CANCELLED' ? 'cancelled' : 'marked no-show'}`, {
    patientId: id,
    doctorId: p.doctorId,
  });
  if (p.slotIndex === null) return;
  const slots = s.slots[p.doctorId];
  const slot = slots[p.slotIndex];
  if (!slot || slot.patientId !== p.id) return;
  slot.patientId = null;
  slot.state = 'VACATED';
  const res = compress(
    slots,
    slot.index,
    (pid, start) => canMake(s, patientOf(s, pid)!, start, now),
    (pid) => isPending(patientOf(s, pid)!),
  );
  for (const m of res.moves) {
    const mp = patientOf(s, m.patientId)!;
    mp.slotIndex = m.toIndex;
    log(s, now, 'COMPRESSION', `Token ${mp.token} — ${mp.name} moved up to ${fmtTime(m.toStart)} (saves ${m.minutesSaved} min)`, {
      patientId: mp.id,
      doctorId: p.doctorId,
      data: { vacatedSlot: m.toIndex, filledBy: mp.id, minutesSaved: m.minutesSaved },
    });
  }
}

export function setDoctorPresent(s: LiveState, doctorId: string, present: boolean, now: Minutes) {
  const d = doctorOf(s, doctorId);
  d.present = present;
  if (present) {
    d.delayMinutes = 0;
    log(s, now, 'DOCTOR_STARTED', `${d.name} is in ${d.room}`, { doctorId });
  }
}

/** Running late / short break. Before arrival: shifts the expected start. */
export function doctorDelay(s: LiveState, doctorId: string, minutes: number, now: Minutes) {
  const d = doctorOf(s, doctorId);
  if (!d.present) d.delayMinutes += minutes;
  else d.breakUntil = Math.max(d.breakUntil ?? now, now) + minutes;
  log(s, now, 'DOCTOR_DELAY_ANNOUNCED', `${d.name} delayed ${minutes} min — patients' leave times updated`, { doctorId, data: { minutes } });
}

export function setCallRate(s: LiveState, doctorId: string, perHour: number, now: Minutes) {
  const d = doctorOf(s, doctorId);
  const old = d.callRatePerHour;
  d.callRatePerHour = Math.max(1, Math.min(20, perHour));
  const slots = s.slots[doctorId];
  const k = slots.findIndex((x) => x.state === 'ASSIGNED' || x.state === 'VACATED');
  if (k >= 0) {
    const base = Math.max(slots[k].scheduledStart, now);
    const len = slotLengthMinutes(d.callRatePerHour);
    for (let i = k; i < slots.length; i++) slots[i].scheduledStart = Math.round(base + (i - k) * len);
  }
  log(s, now, 'CALL_RATE_CHANGED', `${d.name} call rate ${old}/h → ${d.callRatePerHour}/h`, { doctorId });
}

export interface NextDecision {
  next: LivePatient | null;
  /** Someone with an earlier slot who is on their way and not yet late. */
  waitingFor: LivePatient | null;
}

/** Who should the doctor call next? (Algorithm 5 + RBS order protection.) */
export function nextFor(s: LiveState, doctorId: string, now: Minutes): NextDecision {
  const d = doctorOf(s, doctorId);
  const cfg = s.config;
  const model = liveModel(d, cfg.priorWeight);
  const mine = s.patients.filter((p) => p.doctorId === doctorId);
  const prio = (p: LivePatient): PriorityInput => ({
    kind: p.kind,
    readyAt: p.kind === 'EMERGENCY' ? p.checkedInAt! : Math.max(p.checkedInAt!, slotStartOf(s, p) ?? now),
    slotIndex: p.slotIndex ?? -1,
    arrivedAt: p.checkedInAt ?? now,
    id: p.id,
  });
  const waiting = mine.filter((p) => p.status === 'WAITING');
  let waitingFor: LivePatient | null = null;
  const eligible = waiting.filter((c) => {
    if (c.kind === 'EMERGENCY' || c.slotIndex === null) return true;
    const ahead = mine.filter(
      (q) =>
        q.kind === 'ROUTINE' &&
        (q.status === 'EN_ROUTE' || (q.status === 'BOOKED' && q.leaveNowAt !== null)) &&
        q.slotIndex !== null &&
        q.slotIndex < c.slotIndex! &&
        now <= (slotStartOf(s, q) ?? now) + cfg.lateGraceMinutes,
    );
    const blocker = ahead.find((q) => {
      const arrival = q.status === 'EN_ROUTE' ? (q.eta ?? now) : now + q.travelMinutes;
      return now + model.percentile(0.9) > arrival;
    });
    if (blocker && !waitingFor) waitingFor = blocker;
    return !blocker;
  });
  eligible.sort((a, b) => comparePriority(prio(a), prio(b), now, cfg.agingRatePerMinute, cfg.emergencyBasePriority));
  return { next: eligible[0] ?? null, waitingFor: eligible.length ? null : waitingFor };
}

export function callNext(s: LiveState, doctorId: string, now: Minutes, forceId?: string): LivePatient | null {
  const d = doctorOf(s, doctorId);
  if (d.currentId) return null;
  const decision = nextFor(s, doctorId, now);
  const p = forceId ? patientOf(s, forceId) : decision.next;
  if (!p || p.status !== 'WAITING') return null;
  if (!d.present) setDoctorPresent(s, doctorId, true, now);
  p.status = 'IN_CONSULT';
  p.calledAt = now;
  d.currentId = p.id;
  d.currentStartedAt = now;
  if (p.slotIndex !== null) s.slots[doctorId][p.slotIndex].state = 'IN_USE';
  const waited = now - (p.checkedInAt ?? now);
  log(s, now, 'CONSULT_STARTED', `Token ${p.token} — ${p.name} → ${d.room} (waited ${waited} min)`, {
    patientId: p.id,
    doctorId,
    data: { waited, forced: !!forceId && forceId !== decision.next?.id },
  });
  if (p.kind === 'EMERGENCY') {
    const delayed = s.patients.filter((q) => q.doctorId === doctorId && q.kind === 'ROUTINE' && q.status === 'WAITING').length;
    if (delayed) log(s, now, 'EMERGENCY_PREEMPT', `Emergency ${p.name} seen ahead of ${delayed} waiting patient(s)`, { patientId: p.id, doctorId });
  }
  return p;
}

/** End the current consult — and learn from it. */
export function finishCurrent(s: LiveState, doctorId: string, now: Minutes) {
  const d = doctorOf(s, doctorId);
  if (!d.currentId) return;
  const p = patientOf(s, d.currentId)!;
  p.status = 'DONE';
  p.doneAt = now;
  if (p.slotIndex !== null) s.slots[doctorId][p.slotIndex].state = 'COMPLETED';
  const minutes = Math.max(1, now - (d.currentStartedAt ?? now));
  if (p.kind === 'ROUTINE') d.observed.push(minutes);
  d.currentId = null;
  d.currentStartedAt = null;
  log(s, now, 'CONSULT_ENDED', `Token ${p.token} — ${p.name} done (${minutes} min)`, { patientId: p.id, doctorId, data: { minutes } });
  if (p.kind === 'ROUTINE' && d.observed.length % 5 === 0) {
    const m = liveModel(d, s.config.priorWeight);
    log(s, now, 'MODEL_UPDATED', `${d.name}'s consult model re-fitted on ${d.observed.length} real visits: median ${m.median().toFixed(1)}m, p90 ${m.percentile(0.9).toFixed(1)}m`, {
      doctorId,
    });
  }
}

// ---------------------------------------------------------------------------
// Refresh: exchange matching + predictions + advisories (Algorithms 2 & 4)
// ---------------------------------------------------------------------------

export function refresh(s: LiveState, now: Minutes) {
  s.lastRefresh = now;
  const cfg = s.config;

  // Algorithm 4: Pareto slot exchange
  for (const d of s.doctors) {
    const slots = s.slots[d.id];
    const cands: ExchangeCandidate[] = s.patients
      .filter((p) => p.doctorId === d.id && p.kind === 'ROUTINE' && p.optIn && isPending(p) && p.slotIndex !== null && slots[p.slotIndex].state === 'ASSIGNED')
      .map((p) => ({
        patientId: p.id,
        slotIndex: p.slotIndex!,
        slotStart: slots[p.slotIndex!].scheduledStart,
        originalSlotStart: p.originalSlotStart!,
        optIn: true,
        preference: p.preference,
        maxShiftMinutes: p.maxShiftMinutes,
        notBefore: p.notBefore,
      }));
    for (const sw of findSwaps(cands, (id, start) => canMake(s, patientOf(s, id)!, start, now))) {
      const a = patientOf(s, sw.a)!;
      const b = patientOf(s, sw.b)!;
      slots[sw.aFrom].patientId = b.id;
      slots[sw.bFrom].patientId = a.id;
      a.slotIndex = sw.aTo;
      b.slotIndex = sw.bTo;
      log(s, now, 'SWAP', `Swap: ${a.name} ${fmtTime(sw.aFromStart)}→${fmtTime(sw.aToStart)} (${sw.reasonA}); ${b.name} ${fmtTime(sw.bFromStart)}→${fmtTime(sw.bToStart)} (${sw.reasonB})`, {
        doctorId: d.id,
        data: { ...sw },
      });
    }
  }

  // Algorithm 2: ground holding
  for (const d of s.doctors) {
    // A patient told to leave who never acknowledged is not planned around:
    // otherwise one silent no-show would push everyone behind them later forever.
    const silent = (p: LivePatient) => p.status === 'BOOKED' && p.leaveNowAt !== null && now - p.leaveNowAt >= cfg.ackTimeoutMinutes;
    const pend = s.patients.filter((p) => p.doctorId === d.id && isPending(p) && !silent(p));
    if (!pend.length) continue;
    const order = [
      ...pend.filter((p) => p.kind === 'EMERGENCY').sort((a, b) => a.checkedInAt! - b.checkedInAt!),
      ...pend.filter((p) => p.kind === 'ROUTINE').sort((a, b) => a.slotIndex! - b.slotIndex!),
    ];
    const queue: QueueEntry[] = order.map((p) => {
      if (p.status === 'WAITING') return { patientId: p.id, earliest: now, durationFactor: p.kind === 'EMERGENCY' ? 1.6 : 1 };
      if (p.status === 'EN_ROUTE') return { patientId: p.id, earliest: p.eta ?? now, durationFactor: 1 };
      // Pinged but not yet confirmed: expected at ping + travel, not sliding with the clock.
      if (p.leaveNowAt !== null) return { patientId: p.id, earliest: Math.max(now, p.leaveNowAt + p.travelMinutes), durationFactor: 1 };
      let earliest = Math.max((slotStartOf(s, p) ?? now) - cfg.earlyWindowMinutes, now + p.travelMinutes);
      if (p.notBefore !== undefined) earliest = Math.max(earliest, p.notBefore);
      return { patientId: p.id, earliest, durationFactor: 1 };
    });
    const model = liveModel(d, cfg.priorWeight);
    const availableFrom = d.present ? Math.max(now, d.breakUntil ?? now) : Math.max(now, d.sessionStart + d.delayMinutes);
    const preds = predictStarts(
      {
        model,
        now,
        availableFrom,
        currentElapsed: d.currentId && d.currentStartedAt !== null ? now - d.currentStartedAt : null,
        breakAfterCurrent: d.currentId && d.breakUntil && d.breakUntil > now ? d.breakUntil - now : 0,
      },
      queue,
      cfg.monteCarloSamples,
      new Rng(s.seq * 2654435761 + now),
      cfg.advisoryPercentile,
    );
    for (const p of order) {
      p.prediction = preds.get(p.id) ?? null;
      if (p.kind !== 'ROUTINE' || p.status !== 'BOOKED' || p.leaveNowAt !== null || !p.prediction) continue;
      let advised = p.prediction.pAdvisory - p.travelMinutes - cfg.bufferMinutes;
      if (p.notBefore !== undefined) advised = Math.max(advised, p.notBefore - p.travelMinutes);
      advised = Math.floor(advised);
      p.advisedDeparture = advised;
      if (p.notifiedDeparture === null) {
        p.notifiedDeparture = advised;
        log(s, now, 'ADVISORY', `Token ${p.token} — ${p.name}: leave home at ${fmtTime(advised)}`, { patientId: p.id, doctorId: d.id });
      } else if (Math.abs(advised - p.notifiedDeparture) > cfg.revisedThresholdMinutes) {
        const shift = advised - p.notifiedDeparture;
        p.notifiedDeparture = advised;
        log(s, now, 'REVISED_ADVISORY', `Token ${p.token} — ${p.name}: leave ${shift > 0 ? `${shift} min later` : `${-shift} min earlier`}, now ${fmtTime(advised)}`, {
          patientId: p.id,
          doctorId: d.id,
          data: { shift },
        });
      }
      if (now >= advised) {
        p.leaveNowAt = now;
        log(s, now, 'LEAVE_NOW', `Token ${p.token} — ${p.name}: time to leave now`, { patientId: p.id, doctorId: d.id });
      }
    }
  }
}

/** Patients who were told to leave but haven't confirmed — reception should call them. */
export function unresponsive(s: LiveState, now: Minutes): LivePatient[] {
  return s.patients.filter((p) => p.status === 'BOOKED' && p.leaveNowAt !== null && now - p.leaveNowAt >= s.config.ackTimeoutMinutes);
}

export function positionInLine(s: LiveState, p: LivePatient): number {
  if (!isPending(p)) return 0;
  return (
    s.patients.filter(
      (q) =>
        q.doctorId === p.doctorId &&
        q.id !== p.id &&
        isPending(q) &&
        (q.kind === 'EMERGENCY' ? q.status === 'WAITING' : q.slotIndex !== null && p.slotIndex !== null && q.slotIndex < p.slotIndex),
    ).length + 1
  );
}

/** Real visit records — the dataset a day of use produces. */
export function visitRecords(s: LiveState) {
  return s.patients.map((p) => {
    const d = doctorOf(s, p.doctorId);
    return {
      date: s.date,
      token: p.token,
      patient_id: p.id,
      kind: p.kind,
      source: p.source,
      doctor_id: d.id,
      doctor: d.name,
      specialty: d.specialty,
      booked_at: new Date(p.bookedAt).toISOString(),
      slot: slotStartOf(s, p) !== null ? fmtTime(slotStartOf(s, p)!) : '',
      travel_min: p.travelMinutes,
      leave_now_at: p.leaveNowAt !== null ? fmtTime(p.leaveNowAt) : '',
      checked_in_at: p.checkedInAt !== null ? fmtTime(p.checkedInAt) : '',
      called_at: p.calledAt !== null ? fmtTime(p.calledAt) : '',
      done_at: p.doneAt !== null ? fmtTime(p.doneAt) : '',
      wait_min: p.calledAt !== null && p.checkedInAt !== null ? p.calledAt - p.checkedInAt : '',
      consult_min: p.doneAt !== null && p.calledAt !== null ? p.doneAt - p.calledAt : '',
      status: p.status,
      swap_opt_in: p.optIn,
    };
  });
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const t = String(v ?? '');
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}
