/**
 * Metrics and the headline comparison: TARMAC vs today's baseline over the
 * IDENTICAL seeded patient stream.
 */
import { runBaseline } from './baseline';
import { DEFAULT_SCENARIO, generateClinicDay, type ScenarioSpec } from './generator';
import { percentileSorted } from './rng';
import type { RunResult, ScheduledCommand } from './runtime';
import { runTarmac } from './simulation';
import { withConfig, type TarmacConfig } from './types';

export interface Metrics {
  policy: 'TARMAC' | 'BASELINE';
  routinePatientsSeen: number;
  routinePatientsUnseen: number;
  /** Arrival at clinic -> consultation start, routine patients only. */
  meanTimeInClinic: number;
  medianTimeInClinic: number;
  p90TimeInClinic: number;
  maxTimeInClinic: number;
  /** Total patient-hours spent sitting in the clinic. */
  patientHoursInClinic: number;
  doctorIdleMinutes: number;
  doctorOvertimeMinutes: number;
  capacityWastedByNoShowsMinutes: number;
  slotsVacated: number;
  slotsRecoveredByCompression: number;
  minutesSavedByCompression: number;
  swapsExecuted: number;
  advisoriesSent: number;
  revisedAdvisories: number;
  emergenciesSeen: number;
}

const round1 = (x: number) => Math.round(x * 10) / 10;

export function computeMetrics(run: RunResult): Metrics {
  const routine = run.patients.filter((p) => p.kind === 'ROUTINE');
  const seen = routine.filter((p) => p.consultStart !== null && p.arrivedAt !== null);
  const waits = seen.map((p) => p.consultStart! - p.arrivedAt!).sort((a, b) => a - b);
  const mean = waits.length ? waits.reduce((a, b) => a + b, 0) / waits.length : 0;

  let idle = 0;
  let overtime = 0;
  let wasted = 0;
  for (const d of run.doctors) {
    if (d.lastEnd === null) continue;
    const span = d.lastEnd - d.actualStart;
    const dIdle = Math.max(0, span - d.busyMinutes);
    idle += dIdle;
    wasted += Math.min(d.idleNoShowMinutes, dIdle);
    overtime += Math.max(0, d.lastEnd - d.sessionEnd);
  }

  return {
    policy: run.policy,
    routinePatientsSeen: seen.length,
    routinePatientsUnseen: routine.filter((p) => p.status === 'UNSEEN').length,
    meanTimeInClinic: round1(mean),
    medianTimeInClinic: percentileSorted(waits, 0.5) || 0,
    p90TimeInClinic: percentileSorted(waits, 0.9) || 0,
    maxTimeInClinic: waits.length ? waits[waits.length - 1] : 0,
    patientHoursInClinic: round1(waits.reduce((a, b) => a + b, 0) / 60),
    doctorIdleMinutes: idle,
    doctorOvertimeMinutes: overtime,
    capacityWastedByNoShowsMinutes: wasted,
    slotsVacated: run.counters.slotsVacated || routine.filter((p) => p.status === 'NO_SHOW' || p.status === 'CANCELLED').length,
    slotsRecoveredByCompression: run.counters.slotsRecovered,
    minutesSavedByCompression: run.counters.minutesSavedByCompression,
    swapsExecuted: run.counters.swaps,
    advisoriesSent: run.counters.advisoriesSent,
    revisedAdvisories: run.counters.revisedAdvisories,
    emergenciesSeen: run.patients.filter((p) => p.kind === 'EMERGENCY' && p.consultStart !== null).length,
  };
}

export interface MetricsComparison {
  seed: number;
  baseline: Metrics;
  tarmac: Metrics;
  /** Percentage reduction in mean time in clinic (positive = TARMAC better). */
  meanTimeInClinicReductionPct: number;
  p90TimeInClinicReductionPct: number;
  patientHoursReturned: number;
  headline: string;
}

export interface CompareOptions {
  scenario?: ScenarioSpec;
  config?: Partial<TarmacConfig>;
  commands?: ScheduledCommand[];
}

export function compareRuns(seed: number, baselineRun: RunResult, tarmacRun: RunResult): MetricsComparison {
  const baseline = computeMetrics(baselineRun);
  const tarmac = computeMetrics(tarmacRun);
  const pct = (b: number, t: number) => (b > 0 ? round1(((b - t) / b) * 100) : 0);
  const meanPct = pct(baseline.meanTimeInClinic, tarmac.meanTimeInClinic);
  const returned = round1(baseline.patientHoursInClinic - tarmac.patientHoursInClinic);
  return {
    seed,
    baseline,
    tarmac,
    meanTimeInClinicReductionPct: meanPct,
    p90TimeInClinicReductionPct: pct(baseline.p90TimeInClinic, tarmac.p90TimeInClinic),
    patientHoursReturned: returned,
    headline: `TARMAC cuts mean time-in-clinic from ${baseline.meanTimeInClinic} to ${tarmac.meanTimeInClinic} min (-${meanPct}%), returning ${returned} patient-hours in one clinic day.`,
  };
}

/** The pitch-deck number: same seed, same patients, two policies. */
export function compare(seed: number, opts: CompareOptions = {}): MetricsComparison {
  const config = withConfig({ ...opts.config, seed });
  const scenario = opts.scenario ?? DEFAULT_SCENARIO;
  const day = generateClinicDay(seed, scenario);
  const baselineRun = runBaseline(day, config, opts.commands);
  const tarmacRun = runTarmac(day, config, opts.commands);
  return compareRuns(seed, baselineRun, tarmacRun);
}
