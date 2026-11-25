/**
 * Seeded generator for a synthetic clinic day. Everything here is derived
 * from the single seed via named sub-streams, so adding a draw in one place
 * never shifts the values drawn anywhere else.
 */
import { ConsultationTimeModel, syntheticHistory } from './consultation';
import { Rng } from './rng';
import type { ClinicDay, Doctor, EmergencyArrival, ExchangePreference, Patient } from './types';

export interface DoctorSpec {
  id: string;
  name: string;
  specialty: string;
  sessionStart: number;
  sessionEnd: number;
  callRatePerHour: number;
  /** TRUE median consult minutes (the fitted model will be close, not equal). */
  trueMedian: number;
  /** TRUE lognormal sigma — the spread. */
  trueSigma: number;
  /** Number of patients booked with this doctor. */
  bookings: number;
  actualLateStart?: number;
  takesEmergencies?: boolean;
}

export interface ScenarioSpec {
  date: string;
  doctors: DoctorSpec[];
  historicalVisitsPerDoctor: number;
  noShowRate: number;
  cancellationRate: number;
  exchangeOptInRate: number;
  constraintRate: number;
  ignoresAdvisoryRate: number;
  /** Emergency walk-ins per hour across the whole clinic (Poisson). */
  emergencyRatePerHour: number;
  /** Emergency consults are this much longer than the doctor's typical consult. */
  emergencyDurationFactor: number;
}

export const DEFAULT_SCENARIO: ScenarioSpec = {
  date: '2026-11-26',
  doctors: [
    {
      id: 'D1',
      name: 'Dr. Anjali Rao',
      specialty: 'General Medicine',
      sessionStart: 9 * 60,
      sessionEnd: 13 * 60,
      callRatePerHour: 7,
      trueMedian: 7.5,
      trueSigma: 0.22, // fast and consistent
      bookings: 28,
      takesEmergencies: true,
    },
    {
      id: 'D2',
      name: 'Dr. Vikram Deshmukh',
      specialty: 'Cardiology',
      sessionStart: 9 * 60,
      sessionEnd: 13 * 60,
      callRatePerHour: 5,
      trueMedian: 10.5,
      trueSigma: 0.6, // slow with a long tail
      bookings: 20,
      actualLateStart: 0,
      takesEmergencies: true,
    },
    {
      id: 'D3',
      name: 'Dr. Farhan Qureshi',
      specialty: 'Orthopaedics',
      sessionStart: 10 * 60,
      sessionEnd: 14 * 60,
      callRatePerHour: 6,
      trueMedian: 8.5,
      trueSigma: 0.38,
      bookings: 24,
      takesEmergencies: false,
    },
  ],
  historicalVisitsPerDoctor: 400,
  noShowRate: 0.08,
  cancellationRate: 0.05,
  exchangeOptInRate: 0.3,
  constraintRate: 0.08,
  ignoresAdvisoryRate: 0.1,
  emergencyRatePerHour: 0.3,
  emergencyDurationFactor: 1.6,
};

const FIRST = [
  'Aarav', 'Priya', 'Rohan', 'Sneha', 'Vihaan', 'Ananya', 'Kabir', 'Isha', 'Arjun', 'Meera',
  'Siddharth', 'Kavya', 'Aditya', 'Pooja', 'Rahul', 'Neha', 'Omkar', 'Shruti', 'Yash', 'Tanvi',
  'Pranav', 'Riya', 'Harsh', 'Sakshi', 'Nikhil', 'Diya', 'Kunal', 'Aditi', 'Varun', 'Gauri',
  'Tejas', 'Mansi', 'Abhay', 'Payal', 'Sameer', 'Nidhi', 'Ketan', 'Rutuja', 'Mohan', 'Lata',
];
const LAST = [
  'Sharma', 'Patil', 'Deshpande', 'Kulkarni', 'Joshi', 'Wankhede', 'Bhagat', 'Iyer', 'Khan', 'Gupta',
  'Thakre', 'Meshram', 'Chavan', 'Pande', 'Raut', 'Nair', 'Singh', 'Agrawal', 'Bokde', 'Fulzele',
];

const r1 = (x: number) => Math.round(x);

export function generateClinicDay(seed: number, spec: ScenarioSpec = DEFAULT_SCENARIO): ClinicDay {
  const root = new Rng(seed);

  const doctors: Doctor[] = spec.doctors.map((d) => {
    const trueModel = ConsultationTimeModel.fromMedian(d.trueMedian, d.trueSigma);
    const history = syntheticHistory(root.fork(`history:${d.id}`), trueModel, spec.historicalVisitsPerDoctor);
    return {
      id: d.id,
      name: d.name,
      specialty: d.specialty,
      sessionStart: d.sessionStart,
      sessionEnd: d.sessionEnd,
      callRatePerHour: d.callRatePerHour,
      consultModel: ConsultationTimeModel.fit(history),
      actualLateStart: d.actualLateStart ?? 0,
      takesEmergencies: d.takesEmergencies ?? true,
    };
  });

  const patients: Patient[] = [];
  const nameRng = root.fork('names');
  let pn = 0;
  spec.doctors.forEach((d) => {
    const trueModel = ConsultationTimeModel.fromMedian(d.trueMedian, d.trueSigma);
    const rng = root.fork(`patients:${d.id}`);
    const slotLen = 60 / d.callRatePerHour;
    // Booking timestamps over the previous 10 days (negative minutes).
    const bookings = Array.from({ length: d.bookings }, () => -r1(rng.uniform(60, 10 * 24 * 60)));
    bookings.sort((a, b) => a - b);
    bookings.forEach((bookedAt, i) => {
      pn++;
      const id = `P${String(pn).padStart(3, '0')}`;
      const nominalSlot = d.sessionStart + i * slotLen;
      const travelMinutes = r1(Math.min(120, Math.max(8, Math.exp(rng.normal(Math.log(30), 0.55)))));
      const willNoShow = rng.chance(spec.noShowRate);
      const willCancel = !willNoShow && rng.chance(spec.cancellationRate);
      const cancelAt = willCancel ? r1(Math.max(d.sessionStart - 150, nominalSlot - rng.uniform(30, 150))) : undefined;

      // Exchange market participation.
      const optIn = rng.chance(spec.exchangeOptInRate);
      const prefRoll = rng.next();
      const preference: ExchangePreference = !optIn
        ? 'NO_PREFERENCE'
        : prefRoll < 0.5
          ? 'PREFER_EARLIER'
          : 'PREFER_LATER';
      const maxShiftMinutes = r1(rng.uniform(45, 150));

      // Hard constraints: "cannot arrive before X" — set later than their slot
      // for some, which is exactly what makes them want to trade.
      const hasConstraint = rng.chance(spec.constraintRate);
      const notBefore = hasConstraint ? r1(nominalSlot + rng.uniform(20, 90)) : undefined;

      const truth = {
        consultMinutes: Math.max(2, r1(trueModel.sample(rng))),
        willNoShow,
        cancelAt,
        departureDelay: rng.int(0, 6),
        actualTravel: Math.max(3, r1(travelMinutes * rng.uniform(0.9, 1.2))),
        ignoresAdvisory: rng.chance(spec.ignoresAdvisoryRate),
        // "Come at 9" reality: people turn up early to grab a token, some late.
        baselineArrivalOffset: r1(rng.uniform(-45, 30)),
      };

      const first = nameRng.pick(FIRST);
      const last = nameRng.pick(LAST);
      patients.push({
        id,
        name: `${first} ${last}`,
        phone: `+91 9${String(nameRng.int(100000000, 999999999))}`,
        doctorId: d.id,
        bookedAt,
        travelMinutes,
        constraints: notBefore !== undefined ? { notBefore } : {},
        exchange: {
          optIn: optIn || hasConstraint, // constrained patients always want to trade
          preference: hasConstraint ? 'PREFER_LATER' : preference,
          maxShiftMinutes: hasConstraint ? Math.max(maxShiftMinutes, 120) : maxShiftMinutes,
        },
        truth,
      });
    });
  });

  // Emergency walk-ins: Poisson process over the clinic's operating window.
  const emergencies: EmergencyArrival[] = [];
  const eRng = root.fork('emergencies');
  const open = Math.min(...spec.doctors.map((d) => d.sessionStart));
  const close = Math.max(...spec.doctors.map((d) => d.sessionEnd));
  if (spec.emergencyRatePerHour > 0) {
    const emergencyModel = ConsultationTimeModel.fromMedian(10 * spec.emergencyDurationFactor, 0.35);
    let t = open + eRng.exponential(spec.emergencyRatePerHour / 60);
    let en = 0;
    while (t < close) {
      en++;
      emergencies.push({
        id: `E${String(en).padStart(2, '0')}`,
        name: `${eRng.pick(FIRST)} ${eRng.pick(LAST)}`,
        arrivesAt: r1(t),
        consultMinutes: Math.max(5, r1(emergencyModel.sample(eRng))),
      });
      t += eRng.exponential(spec.emergencyRatePerHour / 60);
    }
  }

  return { date: spec.date, seed, doctors, patients, emergencies };
}
