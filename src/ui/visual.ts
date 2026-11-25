import type { EventType, PatientStatus, RuntimePatient } from '../engine';

export const C = {
  navy: '#2c3aa0',
  orange: '#ec8b34',
  red: '#d93a3c',
  green: '#3e9c4d',
  white: '#e9e8e3',
  pink: '#e35b92',
  blue: '#3071d9',
  ink: '#0e0e0e',
  mute: '#6b6a66',
  rule: '#c8c7c2',
  paper: '#ecebe8',
};

export type Phase = 'HOLDING' | 'LEAVE_NOW' | 'EN_ROUTE' | 'WAITING' | 'IN_CONSULT' | 'DONE' | 'GONE' | 'EMERGENCY';

export function phaseOf(p: RuntimePatient): Phase {
  if (p.kind === 'EMERGENCY' && (p.status === 'WAITING')) return 'EMERGENCY';
  switch (p.status as PatientStatus) {
    case 'BOOKED':
      return p.leaveNowAt !== null ? 'LEAVE_NOW' : 'HOLDING';
    case 'EN_ROUTE':
      return 'EN_ROUTE';
    case 'WAITING':
      return 'WAITING';
    case 'IN_CONSULT':
      return 'IN_CONSULT';
    case 'DONE':
      return 'DONE';
    default:
      return 'GONE';
  }
}

export const PHASE: Record<Phase, { color: string; label: string; text: string }> = {
  HOLDING: { color: C.navy, label: 'Held at home', text: '#fff' },
  LEAVE_NOW: { color: C.blue, label: 'Told to leave', text: '#fff' },
  EN_ROUTE: { color: C.orange, label: 'On the way', text: '#111' },
  WAITING: { color: C.red, label: 'In waiting room', text: '#fff' },
  IN_CONSULT: { color: C.green, label: 'With doctor', text: '#fff' },
  DONE: { color: C.white, label: 'Done', text: '#555' },
  GONE: { color: 'transparent', label: 'No-show / cancelled', text: '#fff' },
  EMERGENCY: { color: C.pink, label: 'Emergency', text: '#fff' },
};

export const EVENT_STYLE: Partial<Record<EventType, { color: string; tag: string }>> = {
  ADVISORY: { color: C.navy, tag: 'ADVISORY' },
  REVISED_ADVISORY: { color: C.blue, tag: 'REVISED' },
  LEAVE_NOW: { color: C.blue, tag: 'LEAVE NOW' },
  DEPARTED: { color: C.orange, tag: 'DEPARTED' },
  ARRIVED: { color: C.red, tag: 'ARRIVED' },
  CONSULT_STARTED: { color: C.green, tag: 'CALLED' },
  CONSULT_ENDED: { color: '#9a9994', tag: 'DONE' },
  COMPRESSION: { color: '#111', tag: 'COMPRESS' },
  SWAP: { color: '#7a3fd0', tag: 'SWAP' },
  EMERGENCY_ARRIVED: { color: C.pink, tag: 'EMERGENCY' },
  EMERGENCY_PREEMPT: { color: C.pink, tag: 'PREEMPT' },
  NO_SHOW_DECLARED: { color: '#8a1c1c', tag: 'NO-SHOW' },
  CANCELLED: { color: '#8a1c1c', tag: 'CANCEL' },
  DOCTOR_DELAY_ANNOUNCED: { color: '#b0560f', tag: 'DELAY' },
  DOCTOR_STARTED: { color: C.green, tag: 'DOCTOR IN' },
  CALL_RATE_CHANGED: { color: '#b0560f', tag: 'RATE' },
  EXCHANGE_OPT_IN: { color: '#7a3fd0', tag: 'EXCHANGE' },
  LATE_ARRIVAL_BYPASS: { color: '#555', tag: 'LATE' },
  GAP_FILL: { color: '#555', tag: 'GAP FILL' },
  SLOT_ASSIGNED: { color: '#555', tag: 'RBS' },
  DAY_END: { color: '#111', tag: 'DAY END' },
};

/** Events worth a headline caption during playback. */
export const HEADLINE_EVENTS: EventType[] = [
  'SWAP',
  'COMPRESSION',
  'NO_SHOW_DECLARED',
  'EMERGENCY_ARRIVED',
  'EMERGENCY_PREEMPT',
  'DOCTOR_DELAY_ANNOUNCED',
  'CALL_RATE_CHANGED',
  'DAY_END',
];

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((s) => s[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

export const fmtDur = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, '0')}m` : `${Math.round(min)}m`);
