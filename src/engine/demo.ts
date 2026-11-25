/**
 * The scripted demo day — identical on every replay.
 *
 *  - a normal morning across three doctors
 *  - Dr. Deshmukh (the long-tail cardiologist) announces he is running late
 *  - two patients silently no-show -> declared after missing their LEAVE_NOW
 *    acknowledgement -> compression pulls the queue up
 *  - one emergency walk-in preempts the queue
 *  - two pairs of patients join the slot exchange -> two Pareto swaps
 *
 * Ends with the TARMAC vs baseline comparison over the same patient stream.
 */
import { DEFAULT_SCENARIO, generateClinicDay } from './generator';
import { rationBySchedule } from './rbs';
import type { ScheduledCommand } from './runtime';
import { withConfig, type ClinicDay, type TarmacConfig } from './types';

export const DEMO_SEED = 42;

export interface DemoScenario {
  day: ClinicDay;
  config: TarmacConfig;
  commands: ScheduledCommand[];
}

const hm = (h: number, m: number) => h * 60 + m;

export function demoScenario(): DemoScenario {
  const day = generateClinicDay(DEMO_SEED, {
    ...DEFAULT_SCENARIO,
    noShowRate: 0,
    cancellationRate: 0,
    exchangeOptInRate: 0,
    constraintRate: 0,
    ignoresAdvisoryRate: 0,
    emergencyRatePerHour: 0,
  });
  const config = withConfig({ seed: DEMO_SEED });

  const holder = (doctorId: string, slot: number) => {
    const d = day.doctors.find((x) => x.id === doctorId)!;
    return rationBySchedule(d, day.patients)[slot].patientId!;
  };
  const patient = (id: string) => day.patients.find((p) => p.id === id)!;

  // Two silent no-shows (world truth — the scheduler has to discover them).
  patient(holder('D1', 7)).truth.willNoShow = true;
  patient(holder('D3', 5)).truth.willNoShow = true;

  const commands: ScheduledCommand[] = [
    // Swap #1 — General Medicine: an early patient who'd rather come later,
    // a later patient who'd love to come earlier.
    { at: hm(8, 10), command: { type: 'SET_EXCHANGE', patientId: holder('D1', 10), optIn: true, preference: 'PREFER_LATER', maxShiftMinutes: 120 } },
    { at: hm(8, 12), command: { type: 'SET_EXCHANGE', patientId: holder('D1', 17), optIn: true, preference: 'PREFER_EARLIER', maxShiftMinutes: 120 } },
    // The long-tail doctor is running late.
    { at: hm(8, 40), command: { type: 'DOCTOR_DELAY', doctorId: 'D2', minutes: 30 } },
    // Swap #2 — Orthopaedics.
    { at: hm(9, 20), command: { type: 'SET_EXCHANGE', patientId: holder('D3', 6), optIn: true, preference: 'PREFER_LATER', maxShiftMinutes: 120 } },
    { at: hm(9, 22), command: { type: 'SET_EXCHANGE', patientId: holder('D3', 14), optIn: true, preference: 'PREFER_EARLIER', maxShiftMinutes: 150 } },
    // One emergency walk-in.
    { at: hm(10, 25), command: { type: 'EMERGENCY', name: 'Ramesh Kale', consultMinutes: 22, doctorId: 'D1' } },
  ];

  return { day, config, commands };
}
