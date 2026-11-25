/**
 * Start-time prediction with propagated uncertainty (used by Ground Holding).
 *
 * Adding mean consultation times is wrong for a long-tailed doctor: the
 * errors compound down the queue and the tail is where patients get burnt.
 * Instead we run a small Monte Carlo over the doctor's remaining queue:
 *
 *   t = when the doctor is next free (conditional on how long the current
 *       consult has ALREADY run — an overrunning consult tends to overrun more)
 *   for each patient in queue order:
 *       start = max(t, earliest this patient can/should be seen)
 *       t     = start + sampled consult duration
 *
 * Each patient's predicted start is then a distribution, summarised by
 * percentiles. The Monte Carlo RNG is a fork of the master seed keyed by the
 * clock time and pass number, so predictions are fully reproducible.
 */
import type { ConsultationTimeModel } from './consultation';
import { Rng, percentileSorted } from './rng';
import type { Minutes } from './types';

export interface QueueEntry {
  patientId: string;
  /** Earliest time this patient can be seen (arrival, constraint, early window). */
  earliest: Minutes;
  /** Multiplier on the doctor's consult time (emergencies take longer). */
  durationFactor: number;
}

export interface DoctorState {
  model: ConsultationTimeModel;
  now: Minutes;
  /** Earliest the doctor can start anyone (session start, announced delay). */
  availableFrom: Minutes;
  /** Minutes the current consult has been running, or null if free. */
  currentElapsed: number | null;
  /** Announced break the doctor takes after the current consult (minutes). */
  breakAfterCurrent: number;
}

export interface StartPrediction {
  p10: Minutes;
  p50: Minutes;
  p90: Minutes;
  /** Requested advisory percentile (configurable; default p10). */
  pAdvisory: Minutes;
}

export function predictStarts(
  doctor: DoctorState,
  queue: readonly QueueEntry[],
  samples: number,
  rng: Rng,
  advisoryPercentile: number,
): Map<string, StartPrediction> {
  const starts: number[][] = queue.map(() => new Array<number>(samples));
  for (let s = 0; s < samples; s++) {
    let t = Math.max(doctor.now, doctor.availableFrom);
    if (doctor.currentElapsed !== null) {
      t = Math.max(t, doctor.now + doctor.model.sampleRemaining(rng, doctor.currentElapsed) + doctor.breakAfterCurrent);
    }
    for (let i = 0; i < queue.length; i++) {
      const e = queue[i];
      const start = Math.max(t, e.earliest);
      starts[i][s] = start;
      t = start + Math.max(1, doctor.model.sample(rng) * e.durationFactor);
    }
  }
  const out = new Map<string, StartPrediction>();
  queue.forEach((e, i) => {
    const sorted = starts[i].sort((a, b) => a - b);
    out.set(e.patientId, {
      p10: percentileSorted(sorted, 0.1),
      p50: percentileSorted(sorted, 0.5),
      p90: percentileSorted(sorted, 0.9),
      pAdvisory: percentileSorted(sorted, advisoryPercentile),
    });
  });
  return out;
}
