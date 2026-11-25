/**
 * Domain model. All clock times are integer MINUTES SINCE MIDNIGHT on the
 * clinic day (e.g. 09:30 => 570). Booking timestamps are minutes relative to
 * the same midnight and are typically negative (booked days in advance).
 */
import type { ConsultationTimeModel } from './consultation';

export type Minutes = number;

export interface Doctor {
  id: string;
  name: string;
  specialty: string;
  sessionStart: Minutes;
  sessionEnd: Minutes;
  /** Declared call rate: patients per hour (the clinic's "airport arrival rate"). */
  callRatePerHour: number;
  /** Fitted from synthetic historical visits; what the scheduler BELIEVES. */
  consultModel: ConsultationTimeModel;
  /** Ground truth: minutes the doctor will actually start late (scheduler does not know). */
  actualLateStart: Minutes;
  /** Whether this doctor accepts emergency walk-ins. */
  takesEmergencies: boolean;
}

export type PatientStatus =
  | 'BOOKED' // at home, not yet told to leave
  | 'EN_ROUTE' // left home, travelling
  | 'WAITING' // physically in the waiting room
  | 'IN_CONSULT'
  | 'DONE'
  | 'CANCELLED'
  | 'NO_SHOW'
  | 'UNSEEN'; // still waiting when the simulation hit its hard stop

export type ExchangePreference = 'PREFER_EARLIER' | 'PREFER_LATER' | 'NO_PREFERENCE';

export interface PatientConstraints {
  /** Cannot arrive at the clinic before this clock time. */
  notBefore?: Minutes;
}

export interface ExchangeSettings {
  optIn: boolean;
  preference: ExchangePreference;
  /** Will only accept a slot that moves them by at most this many minutes. */
  maxShiftMinutes: number;
}

/**
 * Hidden ground truth about how a patient will behave. The scheduler never
 * reads this; only the simulator's "world" does. Both schedulers see the same
 * truth for the same seed, which is what makes the comparison fair.
 */
export interface PatientTruth {
  consultMinutes: Minutes;
  willNoShow: boolean;
  /** If set, the patient phones to cancel at this clock time. */
  cancelAt?: Minutes;
  /** Minutes between receiving LEAVE_NOW and actually leaving. */
  departureDelay: Minutes;
  /** Actual travel time on the day (planned travel time +/- traffic). */
  actualTravel: Minutes;
  /** Ignores advisories and turns up at (original slot - 15) anyway. */
  ignoresAdvisory: boolean;
  /** Baseline world: offset from session start at which they turn up. */
  baselineArrivalOffset: Minutes;
}

export interface Patient {
  id: string;
  name: string;
  phone: string;
  doctorId: string;
  /** Booking timestamp — THE property right. RBS order is derived from this. */
  bookedAt: Minutes;
  /** Planned travel time from home, as declared by the patient. */
  travelMinutes: Minutes;
  constraints: PatientConstraints;
  exchange: ExchangeSettings;
  truth: PatientTruth;
}

export interface EmergencyArrival {
  id: string;
  name: string;
  arrivesAt: Minutes;
  consultMinutes: Minutes;
}

export type SlotState = 'ASSIGNED' | 'VACATED' | 'IN_USE' | 'COMPLETED';

export interface Slot {
  doctorId: string;
  index: number;
  scheduledStart: Minutes;
  patientId: string | null;
  state: SlotState;
}

export interface ClinicDay {
  date: string;
  seed: number;
  doctors: Doctor[];
  patients: Patient[];
  emergencies: EmergencyArrival[];
}

// ---------------------------------------------------------------------------
// Event log
// ---------------------------------------------------------------------------

export type EventType =
  | 'SLOT_ASSIGNED'
  | 'ADVISORY'
  | 'REVISED_ADVISORY'
  | 'LEAVE_NOW'
  | 'DEPARTED'
  | 'ARRIVED'
  | 'DOCTOR_STARTED'
  | 'DOCTOR_DELAY_ANNOUNCED'
  | 'CALL_RATE_CHANGED'
  | 'CONSULT_STARTED'
  | 'CONSULT_ENDED'
  | 'CANCELLED'
  | 'NO_SHOW_DECLARED'
  | 'COMPRESSION'
  | 'SWAP'
  | 'EMERGENCY_ARRIVED'
  | 'EMERGENCY_PREEMPT'
  | 'LATE_ARRIVAL_BYPASS'
  | 'GAP_FILL'
  | 'EXCHANGE_OPT_IN'
  | 'BOOKED'
  | 'CHECKED_IN'
  | 'MODEL_UPDATED'
  | 'DAY_END';

export interface EngineEvent {
  seq: number;
  t: Minutes;
  type: EventType;
  patientId?: string;
  doctorId?: string;
  message: string;
  data?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface TarmacConfig {
  seed: number;
  /** Percentile of predicted start used for the advisory (0.1 = p10: arrive a bit early). */
  advisoryPercentile: number;
  /** Extra safety buffer subtracted from the advised departure. */
  bufferMinutes: Minutes;
  /** Emit REVISED_ADVISORY when advised departure moves by more than this. */
  revisedThresholdMinutes: Minutes;
  /** No departure acknowledgement this long after LEAVE_NOW => declared no-show. */
  ackTimeoutMinutes: Minutes;
  /** A patient this late for their own slot may be bypassed by someone who is present. */
  lateGraceMinutes: Minutes;
  /** A patient is never advised to arrive more than this before their slot. */
  earlyWindowMinutes: Minutes;
  /** Priority points per minute of waiting (aging). */
  agingRatePerMinute: number;
  /** Base priority of an emergency walk-in (routine patients start at 0). */
  emergencyBasePriority: number;
  /** Monte Carlo trajectories per prediction pass. */
  monteCarloSamples: number;
  /** Re-estimate at least this often even without events. */
  heartbeatMinutes: Minutes;
  /** Hard stop: give up this many minutes after the latest session end. */
  hardStopAfterSessionMinutes: Minutes;
  enableGroundHolding: boolean;
  enableCompression: boolean;
  enableExchange: boolean;
}

export const DEFAULT_CONFIG: TarmacConfig = {
  seed: 42,
  advisoryPercentile: 0.1,
  bufferMinutes: 5,
  revisedThresholdMinutes: 10,
  ackTimeoutMinutes: 15,
  lateGraceMinutes: 10,
  earlyWindowMinutes: 30,
  agingRatePerMinute: 1,
  emergencyBasePriority: 60,
  monteCarloSamples: 200,
  heartbeatMinutes: 5,
  hardStopAfterSessionMinutes: 360,
  enableGroundHolding: true,
  enableCompression: true,
  enableExchange: true,
};

export function withConfig(partial: Partial<TarmacConfig> = {}): TarmacConfig {
  return { ...DEFAULT_CONFIG, ...partial };
}

export function fmtTime(t: Minutes): string {
  const m = Math.round(t);
  const h = Math.floor(m / 60);
  const mm = ((m % 60) + 60) % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
