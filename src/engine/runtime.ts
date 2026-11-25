/**
 * Runtime state shared by the TARMAC simulation and the baseline scheduler.
 */
import type { StartPrediction } from './predict';
import type {
  ClinicDay,
  EngineEvent,
  ExchangePreference,
  ExchangeSettings,
  Minutes,
  PatientStatus,
  Slot,
  TarmacConfig,
} from './types';

/** External interventions — from the clinic UI or a scripted demo. */
export type Command =
  | { type: 'MARK_NO_SHOW'; patientId: string }
  | { type: 'CANCEL'; patientId: string }
  | { type: 'EMERGENCY'; name: string; consultMinutes: number; doctorId?: string }
  | { type: 'DOCTOR_DELAY'; doctorId: string; minutes: number }
  | { type: 'SET_CALL_RATE'; doctorId: string; perHour: number }
  | { type: 'SET_EXCHANGE'; patientId: string; optIn: boolean; preference: ExchangePreference; maxShiftMinutes?: number };

export interface ScheduledCommand {
  at: Minutes;
  command: Command;
}

export interface RuntimePatient {
  id: string;
  name: string;
  doctorId: string;
  kind: 'ROUTINE' | 'EMERGENCY';
  status: PatientStatus;
  bookedAt: Minutes | null;
  travelMinutes: Minutes;
  notBefore?: Minutes;
  exchange: ExchangeSettings;
  slotIndex: number | null;
  originalSlotIndex: number | null;
  originalSlotStart: Minutes | null;
  /** Current internal estimate of when they should leave home. */
  advisedDeparture: Minutes | null;
  /** Last value actually sent to the patient. */
  notifiedDeparture: Minutes | null;
  prediction: StartPrediction | null;
  leaveNowAt: Minutes | null;
  acked: boolean;
  departAt: Minutes | null;
  departedAt: Minutes | null;
  eta: Minutes | null;
  arrivedAt: Minutes | null;
  consultStart: Minutes | null;
  consultEnd: Minutes | null;
  /** First minute this patient was the present, ready head of the routine line. */
  headSince: Minutes | null;
}

export interface DoctorRuntime {
  id: string;
  name: string;
  sessionStart: Minutes;
  sessionEnd: Minutes;
  callRatePerHour: number;
  started: boolean;
  actualStart: Minutes;
  knownStart: Minutes;
  unavailableUntil: Minutes;
  breakAfterCurrent: Minutes;
  currentPatientId: string | null;
  consultStartedAt: Minutes | null;
  busyMinutes: number;
  idleMinutes: number;
  idleNoShowMinutes: number;
  firstStart: Minutes | null;
  lastEnd: Minutes | null;
}

export interface RunCounters {
  advisoriesSent: number;
  leaveNowSent: number;
  revisedAdvisories: number;
  swaps: number;
  compressions: number;
  slotsVacated: number;
  slotsRecovered: number;
  minutesSavedByCompression: number;
  emergencyPreemptions: number;
}

export interface RunResult {
  policy: 'TARMAC' | 'BASELINE';
  seed: number;
  config: TarmacConfig;
  day: ClinicDay;
  patients: RuntimePatient[];
  doctors: DoctorRuntime[];
  slots: Record<string, Slot[]>;
  events: EngineEvent[];
  counters: RunCounters;
  startedAt: Minutes;
  endedAt: Minutes;
}

export function emptyCounters(): RunCounters {
  return {
    advisoriesSent: 0,
    leaveNowSent: 0,
    revisedAdvisories: 0,
    swaps: 0,
    compressions: 0,
    slotsVacated: 0,
    slotsRecovered: 0,
    minutesSavedByCompression: 0,
    emergencyPreemptions: 0,
  };
}

export const TERMINAL: ReadonlySet<PatientStatus> = new Set(['DONE', 'CANCELLED', 'NO_SHOW', 'UNSEEN']);
export const PENDING: ReadonlySet<PatientStatus> = new Set(['BOOKED', 'EN_ROUTE', 'WAITING']);
