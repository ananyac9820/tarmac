/**
 * Per-doctor consultation-time model: a lognormal distribution fitted by
 * maximum likelihood to (synthetic) historical visit durations.
 *
 * Lognormal is the standard choice for service times: strictly positive,
 * right-skewed, and its tail weight is controlled by sigma. A "fast and
 * consistent" doctor has small sigma; a "slow with a long tail" doctor has a
 * large sigma — and it is the long tail that makes ground holding valuable,
 * because a mean-only estimate badly mis-predicts when that doctor will be free.
 */
import { Rng, normalCdf, normalInv } from './rng';

export class ConsultationTimeModel {
  /** Parameters of the underlying normal: ln(X) ~ N(mu, sigma^2). */
  readonly mu: number;
  readonly sigma: number;
  /** Number of historical visits the model was fitted from (0 = set directly). */
  readonly fittedFrom: number;

  constructor(mu: number, sigma: number, fittedFrom = 0) {
    if (!(sigma > 0)) throw new Error('sigma must be > 0');
    this.mu = mu;
    this.sigma = sigma;
    this.fittedFrom = fittedFrom;
  }

  /** MLE fit: mu = mean(ln x), sigma = sd(ln x). */
  static fit(durations: readonly number[]): ConsultationTimeModel {
    if (durations.length < 2) throw new Error('need at least 2 durations to fit');
    const logs = durations.map((d) => Math.log(Math.max(d, 0.5)));
    const mu = logs.reduce((a, b) => a + b, 0) / logs.length;
    const variance = logs.reduce((a, b) => a + (b - mu) ** 2, 0) / logs.length;
    return new ConsultationTimeModel(mu, Math.sqrt(variance), durations.length);
  }

  /** Build from an intuitive median (minutes) and sigma. */
  static fromMedian(medianMinutes: number, sigma: number): ConsultationTimeModel {
    return new ConsultationTimeModel(Math.log(medianMinutes), sigma);
  }

  sample(rng: Rng): number {
    return Math.exp(rng.normal(this.mu, this.sigma));
  }

  mean(): number {
    return Math.exp(this.mu + (this.sigma * this.sigma) / 2);
  }

  median(): number {
    return Math.exp(this.mu);
  }

  percentile(p: number): number {
    return Math.exp(this.mu + this.sigma * normalInv(p));
  }

  cdf(x: number): number {
    if (x <= 0) return 0;
    return normalCdf((Math.log(x) - this.mu) / this.sigma);
  }

  /**
   * Sample the REMAINING time of a consultation that has already run for
   * `elapsed` minutes, i.e. draw from X | X > elapsed, then subtract elapsed.
   * This is how uncertainty is propagated correctly for the patient currently
   * in the room: a consult that has already overrun is likely to overrun more.
   */
  sampleRemaining(rng: Rng, elapsed: number): number {
    if (elapsed <= 0) return this.sample(rng);
    const lo = this.cdf(elapsed);
    if (lo >= 1 - 1e-9) return 1; // deep in the tail: assume nearly done
    const u = lo + (1 - lo) * rng.next();
    const x = this.percentile(Math.min(u, 1 - 1e-12));
    return Math.max(0.5, x - elapsed);
  }
}

/** Generate synthetic historical visits from a "true" model. */
export function syntheticHistory(rng: Rng, trueModel: ConsultationTimeModel, visits: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < visits; i++) out.push(Math.max(1, Math.round(trueModel.sample(rng) * 10) / 10));
  return out;
}
