/**
 * The TARMAC clinic simulation: a deterministic, minute-resolution
 * discrete-time simulation that runs all five ATC mechanisms together.
 *
 * Two layers are kept strictly apart:
 *  - the WORLD (patient truth: real consult times, who will no-show, actual
 *    travel, whether they follow advice) — read only by world-update code;
 *  - the SCHEDULER (RBS, predictions, advisories, compression, exchange,
 *    priority) — sees only what a real clinic would know.
 *
 * Usage:
 *   const sim = new TarmacSimulation(day, config, scheduledCommands);
 *   sim.step();          // advance one minute (for a live UI)
 *   sim.apply(cmd);      // inject a clinic action right now
 *   const result = sim.runToEnd();
 */
import { compress } from './compression';
import { findSwaps, type ExchangeCandidate } from './exchange';
import { predictStarts, type QueueEntry } from './predict';
import { comparePriority, type PriorityInput } from './priority';
import { rationBySchedule, retimeSlots } from './rbs';
import { Rng } from './rng';
import {
  PENDING,
  TERMINAL,
  emptyCounters,
  type Command,
  type DoctorRuntime,
  type RunCounters,
  type RunResult,
  type RuntimePatient,
  type ScheduledCommand,
} from './runtime';
import {
  fmtTime,
  type ClinicDay,
  type Doctor,
  type EmergencyArrival,
  type EngineEvent,
  type EventType,
  type Minutes,
  type Patient,
  type Slot,
  type TarmacConfig,
} from './types';

const EMERGENCY_DURATION_FACTOR = 1.6;

export class TarmacSimulation {
  readonly day: ClinicDay;
  readonly config: TarmacConfig;
  t: Minutes;
  readonly startedAt: Minutes;
  readonly hardStop: Minutes;
  readonly events: EngineEvent[] = [];
  readonly counters: RunCounters = emptyCounters();
  readonly patients = new Map<string, RuntimePatient>();
  readonly doctors = new Map<string, DoctorRuntime>();
  readonly slots: Record<string, Slot[]> = {};
  finished = false;

  private readonly root: Rng;
  private readonly truth = new Map<string, Patient>();
  private readonly emergencyTruth = new Map<string, EmergencyArrival>();
  private readonly doctorDefs = new Map<string, Doctor>();
  private readonly commands: ScheduledCommand[];
  private seq = 0;
  private pass = 0;
  private dirty = false;
  private lastRecompute = -Infinity;
  private emergencyCounter = 0;

  constructor(day: ClinicDay, config: TarmacConfig, commands: ScheduledCommand[] = []) {
    this.day = day;
    this.config = config;
    this.root = new Rng(config.seed);
    this.commands = [...commands].sort((a, b) => a.at - b.at);
    const open = Math.min(...day.doctors.map((d) => d.sessionStart));
    const close = Math.max(...day.doctors.map((d) => d.sessionEnd));
    this.startedAt = open - 180;
    this.hardStop = close + config.hardStopAfterSessionMinutes;
    this.t = this.startedAt;

    for (const d of day.doctors) {
      this.doctorDefs.set(d.id, d);
      this.doctors.set(d.id, {
        id: d.id,
        name: d.name,
        sessionStart: d.sessionStart,
        sessionEnd: d.sessionEnd,
        callRatePerHour: d.callRatePerHour,
        started: false,
        actualStart: d.sessionStart + d.actualLateStart,
        knownStart: d.sessionStart,
        unavailableUntil: -Infinity,
        breakAfterCurrent: 0,
        currentPatientId: null,
        consultStartedAt: null,
        busyMinutes: 0,
        idleMinutes: 0,
        idleNoShowMinutes: 0,
        firstStart: null,
        lastEnd: null,
      });
    }
    for (const p of day.patients) {
      this.truth.set(p.id, p);
      this.patients.set(p.id, {
        id: p.id,
        name: p.name,
        doctorId: p.doctorId,
        kind: 'ROUTINE',
        status: 'BOOKED',
        bookedAt: p.bookedAt,
        travelMinutes: p.travelMinutes,
        notBefore: p.constraints.notBefore,
        exchange: { ...p.exchange },
        slotIndex: null,
        originalSlotIndex: null,
        originalSlotStart: null,
        advisedDeparture: null,
        notifiedDeparture: null,
        prediction: null,
        leaveNowAt: null,
        acked: false,
        departAt: null,
        departedAt: null,
        eta: null,
        arrivedAt: null,
        consultStart: null,
        consultEnd: null,
        headSince: null,
      });
    }
    for (const e of day.emergencies) this.emergencyTruth.set(e.id, e);

    // ---- Algorithm 1: Ration By Schedule --------------------------------
    for (const d of day.doctors) {
      const slots = rationBySchedule(d, day.patients);
      this.slots[d.id] = slots;
      for (const s of slots) {
        const rp = this.patients.get(s.patientId!)!;
        rp.slotIndex = s.index;
        rp.originalSlotIndex = s.index;
        rp.originalSlotStart = s.scheduledStart;
        this.log('SLOT_ASSIGNED', `${rp.name} booked slot #${s.index + 1} at ${fmtTime(s.scheduledStart)} with ${d.name} (RBS: booking order)`, {
          patientId: rp.id,
          doctorId: d.id,
          data: { slotIndex: s.index, scheduledStart: s.scheduledStart, bookedAt: rp.bookedAt },
        });
        // World: patients who ignore advice plan to arrive 15 min before their booked slot.
        const tr = this.truth.get(rp.id)!;
        if (tr.truth.ignoresAdvisory && !tr.truth.willNoShow && tr.truth.cancelAt === undefined) {
          let dep = s.scheduledStart - 15 - tr.truth.actualTravel;
          if (rp.notBefore !== undefined) dep = Math.max(dep, rp.notBefore - tr.truth.actualTravel);
          rp.departAt = dep;
        }
      }
    }

    if (config.enableExchange) this.exchangePass();
    this.recompute();
  }

  // ------------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------------

  runToEnd(): RunResult {
    while (!this.finished) this.step();
    return this.result();
  }

  result(): RunResult {
    return {
      policy: 'TARMAC',
      seed: this.config.seed,
      config: this.config,
      day: this.day,
      patients: [...this.patients.values()],
      doctors: [...this.doctors.values()],
      slots: this.slots,
      events: this.events,
      counters: this.counters,
      startedAt: this.startedAt,
      endedAt: this.t,
    };
  }

  /** Apply a clinic action immediately at the current clock time. */
  apply(cmd: Command): void {
    const t = this.t;
    switch (cmd.type) {
      case 'MARK_NO_SHOW': {
        const p = this.patients.get(cmd.patientId);
        if (p && p.kind === 'ROUTINE' && (p.status === 'BOOKED' || p.status === 'EN_ROUTE')) {
          this.vacate(p, 'NO_SHOW', `${p.name} marked as no-show by clinic`);
        }
        break;
      }
      case 'CANCEL': {
        const p = this.patients.get(cmd.patientId);
        if (p && p.kind === 'ROUTINE' && PENDING.has(p.status)) {
          this.vacate(p, 'CANCELLED', `${p.name} cancelled`);
        }
        break;
      }
      case 'EMERGENCY': {
        this.emergencyCounter++;
        const id = `X${String(this.emergencyCounter).padStart(2, '0')}`;
        const e: EmergencyArrival = { id, name: cmd.name, arrivesAt: t, consultMinutes: cmd.consultMinutes };
        this.emergencyTruth.set(id, e);
        this.admitEmergency(e, cmd.doctorId);
        break;
      }
      case 'DOCTOR_DELAY': {
        const d = this.doctors.get(cmd.doctorId);
        if (!d) break;
        if (!d.started) {
          d.actualStart += cmd.minutes;
          d.knownStart += cmd.minutes;
        } else if (d.currentPatientId) {
          d.breakAfterCurrent += cmd.minutes;
        } else {
          d.unavailableUntil = Math.max(d.unavailableUntil, t) + cmd.minutes;
        }
        this.log('DOCTOR_DELAY_ANNOUNCED', `${d.name} delayed by ${cmd.minutes} min — all advisories will be re-planned`, {
          doctorId: d.id,
          data: { minutes: cmd.minutes },
        });
        break;
      }
      case 'SET_CALL_RATE': {
        const d = this.doctors.get(cmd.doctorId);
        if (!d) break;
        const old = d.callRatePerHour;
        d.callRatePerHour = cmd.perHour;
        retimeSlots(this.slots[d.id], cmd.perHour);
        this.log('CALL_RATE_CHANGED', `${d.name} declared call rate ${old}/h -> ${cmd.perHour}/h; future slots re-timed`, {
          doctorId: d.id,
          data: { from: old, to: cmd.perHour },
        });
        break;
      }
      case 'SET_EXCHANGE': {
        const p = this.patients.get(cmd.patientId);
        if (!p || p.kind !== 'ROUTINE') break;
        p.exchange = {
          optIn: cmd.optIn,
          preference: cmd.preference,
          maxShiftMinutes: cmd.maxShiftMinutes ?? p.exchange.maxShiftMinutes,
        };
        this.log('EXCHANGE_OPT_IN', `${p.name} ${cmd.optIn ? `joined the slot exchange (${cmd.preference})` : 'left the slot exchange'}`, {
          patientId: p.id,
          doctorId: p.doctorId,
          data: { ...p.exchange },
        });
        break;
      }
    }
    this.dirty = true;
  }

  /** Advance the clock by one minute. */
  step(): void {
    if (this.finished) return;
    const t = this.t;

    // 1. scheduled clinic actions
    while (this.commands.length && this.commands[0].at <= t) this.apply(this.commands.shift()!.command);

    // 2. world: cancellations phoned in
    for (const p of this.patients.values()) {
      if (p.kind !== 'ROUTINE' || !PENDING.has(p.status)) continue;
      const tr = this.truth.get(p.id)!.truth;
      if (tr.cancelAt !== undefined && tr.cancelAt <= t) this.vacate(p, 'CANCELLED', `${p.name} phoned to cancel`);
    }

    // 3. world: emergency walk-ins
    for (const e of this.day.emergencies) if (e.arrivesAt === t) this.admitEmergency(e);

    // 4. world: arrivals at the clinic
    for (const p of this.patients.values()) {
      if (p.status === 'EN_ROUTE' && p.eta !== null && p.eta <= t) {
        p.status = 'WAITING';
        p.arrivedAt = t;
        this.log('ARRIVED', `${p.name} arrived at the clinic`, { patientId: p.id, doctorId: p.doctorId });
      }
    }

    // 5. world: consultations ending
    for (const d of this.doctors.values()) {
      if (!d.currentPatientId) continue;
      const p = this.patients.get(d.currentPatientId)!;
      if (p.consultEnd !== null && p.consultEnd <= t) this.endConsult(d, p);
    }

    // 6. scheduler: declare no-shows (no acknowledgement after LEAVE_NOW)
    for (const p of this.patients.values()) {
      if (p.kind !== 'ROUTINE' || p.status !== 'BOOKED' || p.acked || p.leaveNowAt === null) continue;
      if (t >= p.leaveNowAt + this.config.ackTimeoutMinutes) {
        this.vacate(p, 'NO_SHOW', `${p.name} did not acknowledge LEAVE_NOW within ${this.config.ackTimeoutMinutes} min — declared no-show`);
      }
    }

    // 7. world: doctors arrive
    for (const d of this.doctors.values()) {
      if (!d.started && t >= d.actualStart) {
        d.started = true;
        const late = d.actualStart - d.sessionStart;
        this.log('DOCTOR_STARTED', `${d.name} started${late > 0 ? ` ${late} min late` : ' on time'}`, { doctorId: d.id, data: { late } });
      }
    }

    // 8–9. scheduler: exchange matching + re-prediction on every queue change
    if (this.dirty) {
      if (this.config.enableExchange) this.exchangePass();
      this.recompute();
    } else if (t - this.lastRecompute >= this.config.heartbeatMinutes) {
      this.recompute();
    }
    this.dirty = false;

    // 10. scheduler: LEAVE_NOW notifications (ground holding)
    for (const p of this.patients.values()) {
      if (p.kind !== 'ROUTINE' || p.status !== 'BOOKED' || p.leaveNowAt !== null || p.advisedDeparture === null) continue;
      if (t >= p.advisedDeparture) this.sendLeaveNow(p);
    }

    // 11. world: departures from home
    for (const p of this.patients.values()) {
      if (p.status === 'BOOKED' && p.departAt !== null && p.departAt <= t) {
        const tr = this.truth.get(p.id)!.truth;
        p.status = 'EN_ROUTE';
        p.departedAt = t;
        p.acked = true;
        p.eta = t + tr.actualTravel;
        this.log('DEPARTED', `${p.name} left home, ETA ${fmtTime(p.eta)}`, { patientId: p.id, doctorId: p.doctorId, data: { eta: p.eta } });
      }
    }

    // 12. doctors call the next patient; account idle / busy minutes
    for (const d of this.doctors.values()) this.doctorTick(d);

    // termination
    this.t = t + 1;
    if (this.allResolved()) {
      this.finished = true;
      this.log('DAY_END', 'All patients resolved — day complete', {});
    } else if (this.t >= this.hardStop) {
      for (const p of this.patients.values()) if (PENDING.has(p.status)) p.status = 'UNSEEN';
      this.finished = true;
      this.log('DAY_END', 'Hard stop reached — remaining patients unseen', {});
    }
  }

  // ------------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------------

  private log(type: EventType, message: string, extra: { patientId?: string; doctorId?: string; data?: Record<string, unknown> }): void {
    this.events.push({ seq: this.seq++, t: this.t, type, message, ...extra });
  }

  private slotOf(p: RuntimePatient): Slot | null {
    if (p.slotIndex === null) return null;
    return this.slots[p.doctorId][p.slotIndex] ?? null;
  }

  private slotStart(p: RuntimePatient): Minutes {
    return this.slotOf(p)?.scheduledStart ?? this.t;
  }

  private allResolved(): boolean {
    for (const p of this.patients.values()) if (!TERMINAL.has(p.status)) return false;
    for (const e of this.day.emergencies) if (e.arrivesAt >= this.t) return false;
    return true;
  }

  /** Can this patient physically make a slot starting at `start` (now)? */
  private canMake(patientId: string, start: Minutes): boolean {
    const p = this.patients.get(patientId)!;
    const eff = Math.max(start, this.t);
    if (p.status === 'WAITING') return true; // travel time 0
    if (p.notBefore !== undefined && eff < p.notBefore) return false;
    if (p.status === 'EN_ROUTE') return (p.eta ?? Infinity) <= eff;
    if (p.status === 'BOOKED') return this.t + p.travelMinutes <= eff;
    return false;
  }

  private isMovable(patientId: string): boolean {
    return PENDING.has(this.patients.get(patientId)!.status);
  }

  /** Free a patient's slot (cancel / no-show) and run compression. */
  private vacate(p: RuntimePatient, status: 'CANCELLED' | 'NO_SHOW', message: string): void {
    p.status = status;
    this.log(status === 'CANCELLED' ? 'CANCELLED' : 'NO_SHOW_DECLARED', message, { patientId: p.id, doctorId: p.doctorId });
    const slot = this.slotOf(p);
    this.dirty = true;
    if (!slot || slot.state !== 'ASSIGNED') return;
    slot.patientId = null;
    slot.state = 'VACATED';
    this.counters.slotsVacated++;
    if (!this.config.enableCompression) return;

    // ---- Algorithm 3: Compression ---------------------------------------
    const slots = this.slots[p.doctorId];
    const res = compress(slots, slot.index, (id, start) => this.canMake(id, start), (id) => this.isMovable(id));
    if (res.moves.length === 0) {
      this.log('COMPRESSION', `Slot #${slot.index + 1} (${fmtTime(slot.scheduledStart)}) vacated — no patient could reach the clinic in time`, {
        doctorId: p.doctorId,
        data: { vacatedSlot: slot.index, filledBy: null, minutesSaved: 0 },
      });
      return;
    }
    this.counters.compressions++;
    this.counters.slotsRecovered++;
    for (const m of res.moves) {
      const mp = this.patients.get(m.patientId)!;
      mp.slotIndex = m.toIndex;
      this.counters.minutesSavedByCompression += m.minutesSaved;
      this.log(
        'COMPRESSION',
        `${mp.name} pulled up from #${m.fromIndex + 1} (${fmtTime(m.fromStart)}) to #${m.toIndex + 1} (${fmtTime(m.toStart)}) — saves ${m.minutesSaved} min`,
        {
          patientId: mp.id,
          doctorId: p.doctorId,
          data: { vacatedSlot: m.toIndex, filledBy: mp.id, minutesSaved: m.minutesSaved, fromIndex: m.fromIndex, toIndex: m.toIndex },
        },
      );
    }
  }

  private admitEmergency(e: EmergencyArrival, doctorId?: string): void {
    let doc: DoctorRuntime | undefined = doctorId ? this.doctors.get(doctorId) : undefined;
    if (!doc) {
      const eligible = this.day.doctors.filter((d) => d.takesEmergencies);
      const pool = (eligible.length ? eligible : this.day.doctors).map((d) => this.doctors.get(d.id)!);
      const load = (d: DoctorRuntime) =>
        [...this.patients.values()].filter((p) => p.doctorId === d.id && (p.status === 'WAITING' || p.status === 'IN_CONSULT')).length;
      doc = pool.reduce((best, d) => (load(d) < load(best) ? d : best), pool[0]);
    }
    const rp: RuntimePatient = {
      id: e.id,
      name: e.name,
      doctorId: doc.id,
      kind: 'EMERGENCY',
      status: 'WAITING',
      bookedAt: null,
      travelMinutes: 0,
      exchange: { optIn: false, preference: 'NO_PREFERENCE', maxShiftMinutes: 0 },
      slotIndex: null,
      originalSlotIndex: null,
      originalSlotStart: null,
      advisedDeparture: null,
      notifiedDeparture: null,
      prediction: null,
      leaveNowAt: null,
      acked: true,
      departAt: null,
      departedAt: null,
      eta: null,
      arrivedAt: this.t,
      consultStart: null,
      consultEnd: null,
      headSince: null,
    };
    this.patients.set(rp.id, rp);
    if (!this.emergencyTruth.has(e.id)) this.emergencyTruth.set(e.id, e);
    this.log('EMERGENCY_ARRIVED', `EMERGENCY: ${e.name} walked in — routed to ${doc.name}`, { patientId: rp.id, doctorId: doc.id });
    this.dirty = true;
  }

  private sendLeaveNow(p: RuntimePatient): void {
    const tr = this.truth.get(p.id)!.truth;
    p.leaveNowAt = this.t;
    this.counters.advisoriesSent++;
    this.counters.leaveNowSent++;
    this.log('LEAVE_NOW', `LEAVE NOW sent to ${p.name} (${p.travelMinutes} min away)`, {
      patientId: p.id,
      doctorId: p.doctorId,
      data: { predictedStart: p.prediction?.pAdvisory ?? null },
    });
    // World response
    if (tr.willNoShow || tr.cancelAt !== undefined) return; // silence
    p.acked = true;
    if (tr.ignoresAdvisory) return; // acknowledges, but keeps own plan
    let dep = this.t + tr.departureDelay;
    if (p.notBefore !== undefined) dep = Math.max(dep, p.notBefore - tr.actualTravel);
    p.departAt = dep;
  }

  private endConsult(d: DoctorRuntime, p: RuntimePatient): void {
    p.status = 'DONE';
    const slot = this.slotOf(p);
    if (slot) slot.state = 'COMPLETED';
    d.currentPatientId = null;
    d.consultStartedAt = null;
    d.lastEnd = this.t;
    if (d.breakAfterCurrent > 0) {
      d.unavailableUntil = this.t + d.breakAfterCurrent;
      d.breakAfterCurrent = 0;
    }
    this.log('CONSULT_ENDED', `${p.name} finished with ${d.name}`, { patientId: p.id, doctorId: d.id });
    this.dirty = true;
  }

  private readyAt(p: RuntimePatient): Minutes {
    if (p.kind === 'EMERGENCY') return p.arrivedAt!;
    return Math.max(p.arrivedAt!, this.slotStart(p));
  }

  private prio(p: RuntimePatient): PriorityInput {
    return { kind: p.kind, readyAt: this.readyAt(p), slotIndex: p.slotIndex ?? -1, arrivedAt: p.arrivedAt ?? 0, id: p.id };
  }

  /** Earliest the scheduler believes an absent patient could be in the room. */
  private expectedArrival(p: RuntimePatient): Minutes {
    if (p.status === 'EN_ROUTE') return p.eta ?? this.t;
    const leave = Math.max(this.t, p.advisedDeparture ?? this.t);
    return leave + p.travelMinutes;
  }

  private doctorTick(d: DoctorRuntime): void {
    const t = this.t;
    if (d.currentPatientId) {
      d.busyMinutes++;
      return;
    }
    if (!d.started || t < d.unavailableUntil) return;

    const mine = [...this.patients.values()].filter((p) => p.doctorId === d.id);
    const hasPending = mine.some((p) => PENDING.has(p.status));
    if (!hasPending) return;

    const cfg = this.config;
    const cmp = (a: RuntimePatient, b: RuntimePatient) =>
      comparePriority(this.prio(a), this.prio(b), t, cfg.agingRatePerMinute, cfg.emergencyBasePriority);

    const waiting = mine.filter((p) => p.status === 'WAITING');
    const routineWaiting = waiting.filter((p) => p.kind === 'ROUTINE' && this.readyAt(p) <= t).sort(cmp);
    if (routineWaiting.length && routineWaiting[0].headSince === null) routineWaiting[0].headSince = t;

    const absentAhead = (c: RuntimePatient) =>
      mine.filter(
        (q) =>
          q.kind === 'ROUTINE' &&
          (q.status === 'BOOKED' || q.status === 'EN_ROUTE') &&
          q.slotIndex !== null &&
          c.slotIndex !== null &&
          q.slotIndex < c.slotIndex,
      );
    const model = this.doctorDefs.get(d.id)!.consultModel;

    // A routine candidate may not jump an absent patient who is not yet late,
    // unless the consult will (p90) finish before that patient can arrive.
    let gapFillFor: RuntimePatient[] = [];
    let bypassedLate: RuntimePatient[] = [];
    const eligible = waiting.filter((c) => {
      if (c.kind === 'EMERGENCY') return true;
      const ahead = absentAhead(c);
      const notLate = ahead.filter((q) => t <= this.slotStart(q) + cfg.lateGraceMinutes);
      if (notLate.length === 0) return true;
      const fits = notLate.every((q) => t + model.percentile(0.9) <= this.expectedArrival(q));
      return fits;
    });
    if (eligible.length === 0) {
      d.idleMinutes++;
      this.chargeNoShowIdle(d);
      return;
    }
    eligible.sort(cmp);
    const next = eligible[0];

    if (next.kind === 'ROUTINE') {
      const ahead = absentAhead(next);
      bypassedLate = ahead.filter((q) => t > this.slotStart(q) + cfg.lateGraceMinutes);
      gapFillFor = ahead.filter((q) => t <= this.slotStart(q) + cfg.lateGraceMinutes);
      const lateWaiting = waiting.filter((q) => q.kind === 'ROUTINE' && q.slotIndex !== null && next.slotIndex !== null && q.slotIndex < next.slotIndex);
      for (const q of [...bypassedLate, ...lateWaiting]) {
        this.log('LATE_ARRIVAL_BYPASS', `${next.name} called before ${q.name}, who was late for slot ${fmtTime(this.slotStart(q))}`, {
          patientId: q.id,
          doctorId: d.id,
          data: { calledInstead: next.id },
        });
      }
      for (const q of gapFillFor) {
        this.log('GAP_FILL', `${next.name} seen while ${q.name} is still on the way (fits before their ETA)`, {
          patientId: next.id,
          doctorId: d.id,
          data: { aheadOf: q.id },
        });
      }
    } else {
      const delayed = routineWaiting.map((q) => q.id);
      if (delayed.length) {
        this.counters.emergencyPreemptions++;
        this.log('EMERGENCY_PREEMPT', `Emergency ${next.name} seen ahead of ${delayed.length} waiting patient(s)`, {
          patientId: next.id,
          doctorId: d.id,
          data: { delayed },
        });
      }
    }
    this.startConsult(d, next);
    d.busyMinutes++;
  }

  private chargeNoShowIdle(d: DoctorRuntime): void {
    const slots = this.slots[d.id];
    let covering: Slot | null = null;
    for (const s of slots) if (s.scheduledStart <= this.t) covering = s;
    if (covering && covering.state === 'VACATED') d.idleNoShowMinutes++;
  }

  private startConsult(d: DoctorRuntime, p: RuntimePatient): void {
    const minutes =
      p.kind === 'EMERGENCY' ? this.emergencyTruth.get(p.id)!.consultMinutes : this.truth.get(p.id)!.truth.consultMinutes;
    p.status = 'IN_CONSULT';
    p.consultStart = this.t;
    p.consultEnd = this.t + minutes;
    const slot = this.slotOf(p);
    if (slot) slot.state = 'IN_USE';
    d.currentPatientId = p.id;
    d.consultStartedAt = this.t;
    if (d.firstStart === null) d.firstStart = this.t;
    this.log('CONSULT_STARTED', `${d.name} called ${p.name} (waited ${this.t - (p.arrivedAt ?? this.t)} min in clinic)`, {
      patientId: p.id,
      doctorId: d.id,
      data: { waited: this.t - (p.arrivedAt ?? this.t) },
    });
    this.dirty = true;
  }

  // ---- Algorithm 4: Slot exchange ----------------------------------------
  private exchangePass(): void {
    for (const d of this.day.doctors) {
      const slots = this.slots[d.id];
      const cands: ExchangeCandidate[] = [];
      for (const p of this.patients.values()) {
        if (p.doctorId !== d.id || p.kind !== 'ROUTINE' || !p.exchange.optIn || !PENDING.has(p.status)) continue;
        const s = this.slotOf(p);
        if (!s || s.state !== 'ASSIGNED') continue;
        cands.push({
          patientId: p.id,
          slotIndex: s.index,
          slotStart: s.scheduledStart,
          originalSlotStart: p.originalSlotStart!,
          optIn: true,
          preference: p.exchange.preference,
          maxShiftMinutes: p.exchange.maxShiftMinutes,
          notBefore: p.notBefore,
        });
      }
      if (cands.length < 2) continue;
      const swaps = findSwaps(cands, (id, start) => this.canMake(id, start));
      for (const sw of swaps) {
        const a = this.patients.get(sw.a)!;
        const b = this.patients.get(sw.b)!;
        slots[sw.aFrom].patientId = b.id;
        slots[sw.bFrom].patientId = a.id;
        a.slotIndex = sw.aTo;
        b.slotIndex = sw.bTo;
        this.counters.swaps++;
        this.log(
          'SWAP',
          `SWAP: ${a.name} ${fmtTime(sw.aFromStart)} -> ${fmtTime(sw.aToStart)} (${sw.reasonA}); ${b.name} ${fmtTime(sw.bFromStart)} -> ${fmtTime(sw.bToStart)} (${sw.reasonB})`,
          { doctorId: d.id, data: { ...sw } },
        );
      }
      if (swaps.length) this.dirty = true;
    }
  }

  // ---- Algorithm 2: Ground holding ---------------------------------------
  private recompute(): void {
    const t = this.t;
    this.lastRecompute = t;
    this.pass++;
    const cfg = this.config;
    for (const def of this.day.doctors) {
      const d = this.doctors.get(def.id)!;
      const mine = [...this.patients.values()].filter((p) => p.doctorId === d.id && PENDING.has(p.status));
      if (mine.length === 0) continue;
      const emergencies = mine.filter((p) => p.kind === 'EMERGENCY').sort((a, b) => a.arrivedAt! - b.arrivedAt! || (a.id < b.id ? -1 : 1));
      const routine = mine.filter((p) => p.kind === 'ROUTINE').sort((a, b) => a.slotIndex! - b.slotIndex!);
      const order = [...emergencies, ...routine];
      const queue: QueueEntry[] = order.map((p) => {
        if (p.kind === 'EMERGENCY' || p.status === 'WAITING') return { patientId: p.id, earliest: t, durationFactor: p.kind === 'EMERGENCY' ? EMERGENCY_DURATION_FACTOR : 1 };
        if (p.status === 'EN_ROUTE') return { patientId: p.id, earliest: p.eta ?? t, durationFactor: 1 };
        let earliest = Math.max(this.slotStart(p) - cfg.earlyWindowMinutes, t + p.travelMinutes);
        if (p.notBefore !== undefined) earliest = Math.max(earliest, p.notBefore);
        return { patientId: p.id, earliest, durationFactor: 1 };
      });
      const current = d.currentPatientId ? this.patients.get(d.currentPatientId)! : null;
      const preds = predictStarts(
        {
          model: def.consultModel,
          now: t,
          availableFrom: d.started ? d.unavailableUntil : Math.max(d.knownStart, d.unavailableUntil),
          currentElapsed: current && d.consultStartedAt !== null ? t - d.consultStartedAt : null,
          breakAfterCurrent: d.breakAfterCurrent,
        },
        queue,
        cfg.monteCarloSamples,
        this.root.fork(`mc:${d.id}:${t}:${this.pass}`),
        cfg.advisoryPercentile,
      );
      for (const p of order) {
        p.prediction = preds.get(p.id) ?? null;
        if (p.kind !== 'ROUTINE' || p.status !== 'BOOKED' || p.leaveNowAt !== null || !p.prediction) continue;
        let advised = cfg.enableGroundHolding
          ? p.prediction.pAdvisory - p.travelMinutes - cfg.bufferMinutes
          : this.slotStart(p) - p.travelMinutes - 15;
        if (p.notBefore !== undefined) advised = Math.max(advised, p.notBefore - p.travelMinutes);
        advised = Math.floor(advised);
        p.advisedDeparture = advised;
        if (p.notifiedDeparture === null) {
          p.notifiedDeparture = advised;
          this.counters.advisoriesSent++;
          this.log('ADVISORY', `${p.name}: plan to leave home at ${fmtTime(advised)} (slot ${fmtTime(this.slotStart(p))})`, {
            patientId: p.id,
            doctorId: d.id,
            data: { advisedDeparture: advised, p10: p.prediction.p10, p50: p.prediction.p50, p90: p.prediction.p90 },
          });
        } else if (Math.abs(advised - p.notifiedDeparture) > cfg.revisedThresholdMinutes) {
          const shift = advised - p.notifiedDeparture;
          p.notifiedDeparture = advised;
          this.counters.advisoriesSent++;
          this.counters.revisedAdvisories++;
          this.log(
            'REVISED_ADVISORY',
            `${p.name}: leave ${shift > 0 ? `${shift} min LATER` : `${-shift} min EARLIER`} — now ${fmtTime(advised)}`,
            { patientId: p.id, doctorId: d.id, data: { advisedDeparture: advised, shift, p10: p.prediction.p10, p50: p.prediction.p50, p90: p.prediction.p90 } },
          );
        }
      }
    }
  }
}

export function runTarmac(day: ClinicDay, config: TarmacConfig, commands: ScheduledCommand[] = []): RunResult {
  return new TarmacSimulation(day, config, commands).runToEnd();
}
