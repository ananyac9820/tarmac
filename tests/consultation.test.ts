import { describe, expect, it } from 'vitest';
import { ConsultationTimeModel, Rng, generateClinicDay, syntheticHistory } from '../src/engine';

describe('ConsultationTimeModel (lognormal)', () => {
  it('MLE fit recovers the true parameters from synthetic history', () => {
    const truth = ConsultationTimeModel.fromMedian(10, 0.5);
    const fitted = ConsultationTimeModel.fit(syntheticHistory(new Rng(1), truth, 5000));
    expect(fitted.mu).toBeCloseTo(truth.mu, 1);
    expect(fitted.sigma).toBeCloseTo(truth.sigma, 1);
    expect(fitted.fittedFrom).toBe(5000);
  });

  it('mean, percentile and sample agree with each other', () => {
    const m = ConsultationTimeModel.fromMedian(8, 0.4);
    const rng = new Rng(5);
    const xs = Array.from({ length: 20000 }, () => m.sample(rng)).sort((a, b) => a - b);
    const empiricalMean = xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(empiricalMean).toBeCloseTo(m.mean(), 0);
    expect(xs[Math.floor(0.9 * xs.length)]).toBeCloseTo(m.percentile(0.9), 0);
    expect(m.percentile(0.5)).toBeCloseTo(8, 6);
  });

  it('doctors have genuinely different spreads: one fast & consistent, one slow with a long tail', () => {
    const day = generateClinicDay(42);
    const fast = day.doctors.find((d) => d.id === 'D1')!.consultModel;
    const slow = day.doctors.find((d) => d.id === 'D2')!.consultModel;
    expect(fast.mean()).toBeLessThan(slow.mean());
    const tail = (m: ConsultationTimeModel) => m.percentile(0.9) / m.percentile(0.5);
    expect(tail(slow)).toBeGreaterThan(1.8); // long tail
    expect(tail(fast)).toBeLessThan(1.4); // consistent
  });

  it('remaining-time sampling is conditional on elapsed time', () => {
    const m = ConsultationTimeModel.fromMedian(10, 0.6);
    const rng = new Rng(9);
    const fresh = Array.from({ length: 5000 }, () => m.sample(rng));
    const overrun = Array.from({ length: 5000 }, () => 25 + m.sampleRemaining(rng, 25));
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(Math.min(...overrun)).toBeGreaterThanOrEqual(25);
    expect(avg(overrun)).toBeGreaterThan(avg(fresh));
  });
});
