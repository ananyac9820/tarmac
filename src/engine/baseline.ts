/**
 * BaselineScheduler — today's reality in most Indian OPDs.
 *
 * Everyone is told to come at the session start. Patients are seen
 * first-come-first-served by arrival time. No advisories, no compression, no
 * exchange. Emergencies are seen first (strict priority) — the same clinical
 * rule TARMAC uses, minus the aging protection.
 *
 * It consumes the IDENTICAL seeded patient stream as TARMAC (same consult
 * durations, same no-shows, same cancellations, same emergencies, same
 * doctor lateness), so the comparison isolates the scheduling policy.
 */
import { rationBySchedule } from './rbs';
import {
  PENDING,
  TERMINAL,
  emptyCounters,
  type DoctorRuntime,
  type RunResult,
  type RuntimePatient,
  type ScheduledCommand,
} from './runtime';
import { fmtTime, type ClinicDay, type EngineEvent, type EventType, type Minutes, type Slot, type TarmacConfig } from './types';

export class BaselineScheduler {
  constructor(
    readonly day: ClinicDay,
    readonly config: TarmacConfig,
    readonly commands: ScheduledCommand[] = [],
  ) {}

  run(): RunResult {
    const { day, config } = this;
    const events: EngineEvent[] = [];
    let seq = 0;
    let t: Minutes = Math.min(...day.doctors.map((d) => d.sessionStart)) - 180;
    const startedAt = t;
    const hardStop = Math.max(...day.doctors.map((d) => d.sessionEnd)) + config.hardStopAfterSessionMinutes;
    const log = (type: EventType, message: string, extra: { patientId?: string; doctorId?: string; data?: Record<string, unknown> } = {}) =>
      events.push({ seq: seq++, t, type, message, ...extra });

    const truth = new Map(day.patients.map((p) => [p.id, p]));
    const consultMinutes = new Map<string, number>();
    const patients = new Map<string, RuntimePatient>();
    const slots: Record<string, Slot[]> = {};
    const plannedArrival = new Map<string, Minutes | null>();
    const counters = emptyCounters();

    const doctors = new Map<string, DoctorRuntime>(
      day.doctors.map((d) => [
        d.id,
        {
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
        },
      ]),
    );

    for (const d of day.doctors) {
      // Slots exist only as a reference grid for no-show accounting; the
      // baseline does not use them to schedule anyone.
      slots[d.id] = rationBySchedule(d, day.patients);
    }
    for (const p of day.patients) {
      const doc = day.doctors.find((d) => d.id === p.doctorId)!;
      const slot = slots[p.doctorId].find((s) => s.patientId === p.id)!;
      consultMinutes.set(p.id, p.truth.consultMinutes);
      patients.set(p.id, {
        id: p.id,
        name: p.name,
        doctorId: p.doctorId,
        kind: 'ROUTINE',
        status: 'BOOKED',
        bookedAt: p.bookedAt,
        travelMinutes: p.travelMinutes,
        notBefore: p.constraints.notBefore,
        exchange: { ...p.exchange },
        slotIndex: slot.index,
        originalSlotIndex: slot.index,
        originalSlotStart: slot.scheduledStart,
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
      const comes = !p.truth.willNoShow && p.truth.cancelAt === undefined;
      let arr = doc.sessionStart + p.truth.baselineArrivalOffset;
      if (p.constraints.notBefore !== undefined) arr = Math.max(arr, p.constraints.notBefore);
      plannedArrival.set(p.id, comes ? arr : null);
    }

    const sortedCommands = [...this.commands].sort((a, b) => a.at - b.at);
    let xCount = 0;
    const admitEmergency = (id: string, name: string, minutes: number, doctorId?: string) => {
      let doc = doctorId ? doctors.get(doctorId) : undefined;
      if (!doc) {
        const eligible = day.doctors.filter((d) => d.takesEmergencies);
        const pool = (eligible.length ? eligible : day.doctors).map((d) => doctors.get(d.id)!);
        const load = (d: DoctorRuntime) =>
          [...patients.values()].filter((p) => p.doctorId === d.id && (p.status === 'WAITING' || p.status === 'IN_CONSULT')).length;
        doc = pool.reduce((best, d) => (load(d) < load(best) ? d : best), pool[0]);
      }
      consultMinutes.set(id, minutes);
      patients.set(id, {
        id,
        name,
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
        arrivedAt: t,
        consultStart: null,
        consultEnd: null,
        headSince: null,
      });
      log('EMERGENCY_ARRIVED', `EMERGENCY: ${name} walked in — routed to ${doc.name}`, { patientId: id, doctorId: doc.id });
    };

    const allResolved = () => {
      for (const p of patients.values()) if (!TERMINAL.has(p.status)) return false;
      for (const e of day.emergencies) if (e.arrivesAt >= t) return false;
      return true;
    };

    for (;;) {
      while (sortedCommands.length && sortedCommands[0].at <= t) {
        const cmd = sortedCommands.shift()!.command;
        if (cmd.type === 'EMERGENCY') admitEmergency(`X${String(++xCount).padStart(2, '0')}`, cmd.name, cmd.consultMinutes, cmd.doctorId);
        else if (cmd.type === 'DOCTOR_DELAY') {
          const d = doctors.get(cmd.doctorId);
          if (d && !d.started) d.actualStart += cmd.minutes;
          else if (d && d.currentPatientId) d.breakAfterCurrent += cmd.minutes;
          else if (d) d.unavailableUntil = Math.max(d.unavailableUntil, t) + cmd.minutes;
        } else if (cmd.type === 'MARK_NO_SHOW' || cmd.type === 'CANCEL') {
          const p = patients.get(cmd.patientId);
          if (p && (p.status === 'BOOKED' || p.status === 'EN_ROUTE')) {
            p.status = cmd.type === 'CANCEL' ? 'CANCELLED' : 'NO_SHOW';
            plannedArrival.set(p.id, null);
          }
        }
      }
      for (const e of day.emergencies) if (e.arrivesAt === t) admitEmergency(e.id, e.name, e.consultMinutes);

      for (const p of patients.values()) {
        if (p.kind !== 'ROUTINE' || p.status !== 'BOOKED') continue;
        const tr = truth.get(p.id)!.truth;
        if (tr.cancelAt !== undefined && tr.cancelAt <= t) {
          p.status = 'CANCELLED';
          continue;
        }
        const arr = plannedArrival.get(p.id);
        if (arr !== null && arr !== undefined && arr <= t) {
          p.status = 'WAITING';
          p.arrivedAt = t;
          log('ARRIVED', `${p.name} arrived (told to come at ${fmtTime(doctors.get(p.doctorId)!.sessionStart)})`, { patientId: p.id, doctorId: p.doctorId });
        }
      }

      for (const d of doctors.values()) {
        if (d.currentPatientId) {
          const p = patients.get(d.currentPatientId)!;
          if (p.consultEnd! <= t) {
            p.status = 'DONE';
            d.currentPatientId = null;
            d.consultStartedAt = null;
            d.lastEnd = t;
            if (d.breakAfterCurrent > 0) {
              d.unavailableUntil = t + d.breakAfterCurrent;
              d.breakAfterCurrent = 0;
            }
            log('CONSULT_ENDED', `${p.name} finished with ${d.name}`, { patientId: p.id, doctorId: d.id });
          }
        }
        if (!d.started && t >= d.actualStart) {
          d.started = true;
          log('DOCTOR_STARTED', `${d.name} started`, { doctorId: d.id });
        }
      }

      // Residual no-shows: anyone still not here at session end is a no-show.
      for (const p of patients.values()) {
        if (p.kind === 'ROUTINE' && p.status === 'BOOKED' && plannedArrival.get(p.id) == null && t >= doctors.get(p.doctorId)!.sessionEnd) {
          p.status = 'NO_SHOW';
        }
      }

      for (const d of doctors.values()) {
        if (d.currentPatientId) {
          d.busyMinutes++;
          continue;
        }
        if (!d.started || t < d.unavailableUntil) continue;
        const mine = [...patients.values()].filter((p) => p.doctorId === d.id);
        if (!mine.some((p) => PENDING.has(p.status))) continue;
        const waiting = mine
          .filter((p) => p.status === 'WAITING')
          .sort(
            (a, b) =>
              (a.kind === b.kind ? 0 : a.kind === 'EMERGENCY' ? -1 : 1) ||
              a.arrivedAt! - b.arrivedAt! ||
              (a.bookedAt ?? 0) - (b.bookedAt ?? 0) ||
              (a.id < b.id ? -1 : 1),
          );
        if (waiting.length === 0) {
          d.idleMinutes++;
          let covering: Slot | null = null;
          for (const s of slots[d.id]) if (s.scheduledStart <= t) covering = s;
          if (covering?.patientId) {
            const holder = patients.get(covering.patientId)!;
            if (holder.status === 'NO_SHOW' || holder.status === 'CANCELLED' || plannedArrival.get(holder.id) == null) d.idleNoShowMinutes++;
          }
          continue;
        }
        const p = waiting[0];
        p.status = 'IN_CONSULT';
        p.consultStart = t;
        p.consultEnd = t + consultMinutes.get(p.id)!;
        d.currentPatientId = p.id;
        d.consultStartedAt = t;
        if (d.firstStart === null) d.firstStart = t;
        d.busyMinutes++;
        log('CONSULT_STARTED', `${d.name} called ${p.name} (waited ${t - p.arrivedAt!} min)`, { patientId: p.id, doctorId: d.id, data: { waited: t - p.arrivedAt! } });
      }

      t++;
      if (allResolved()) break;
      if (t >= hardStop) {
        for (const p of patients.values()) if (PENDING.has(p.status)) p.status = 'UNSEEN';
        break;
      }
    }
    for (const p of patients.values()) if (p.kind === 'ROUTINE' && p.status === 'BOOKED') p.status = 'NO_SHOW';
    log('DAY_END', 'Baseline day complete');

    return {
      policy: 'BASELINE',
      seed: config.seed,
      config,
      day,
      patients: [...patients.values()],
      doctors: [...doctors.values()],
      slots,
      events,
      counters,
      startedAt,
      endedAt: t,
    };
  }
}

export function runBaseline(day: ClinicDay, config: TarmacConfig, commands: ScheduledCommand[] = []): RunResult {
  return new BaselineScheduler(day, config, commands).run();
}
