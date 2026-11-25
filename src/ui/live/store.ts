/**
 * Offline, multi-view clinic store.
 *
 * The clinic state lives in localStorage and every open tab/window stays in
 * sync through BroadcastChannel + the `storage` event. Open Patient,
 * Reception, Doctor and Display in four windows on one machine and they
 * behave like four devices.
 *
 * Exactly one tab (elected with the Web Locks API) runs the clinic clock:
 * periodic re-prediction, advisories, and the optional autopilot.
 *
 * To go multi-device, swap `read`/`write`/`subscribe` for a hosted store
 * (e.g. Supabase or Vercel KV) — nothing else changes.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  book,
  createLiveState,
  generateClinicDay,
  refresh,
  type DoctorSeed,
  type LiveState,
  type NoShowModel,
} from '../../engine';
import { autopilot } from './autopilot';

export interface Clock {
  mode: 'REAL' | 'DEMO';
  /** DEMO: clinic minute at baseMs */
  baseMinute: number;
  baseMs: number;
  /** DEMO: clinic minutes per real second */
  speed: number;
  paused: boolean;
}

export interface Autopilot {
  patients: boolean;
  doctors: boolean;
  desk: boolean;
}

export interface Stored {
  rev: number;
  live: LiveState;
  clock: Clock;
  autopilot: Autopilot;
  noShow: NoShowModel | null;
}

const KEY = 'tarmac.clinic.v1';
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('tarmac') : null;
const listeners = new Set<() => void>();
let cache: { raw: string | null; value: Stored } | null = null;

const ROOMS = ['Room 1', 'Room 2', 'Room 3', 'Room 4'];

export function defaultDoctors(): DoctorSeed[] {
  const day = generateClinicDay(42);
  return day.doctors.map((d, i) => ({
    id: d.id,
    name: d.name,
    specialty: d.specialty,
    room: ROOMS[i] ?? `Room ${i + 1}`,
    sessionStart: d.sessionStart,
    sessionEnd: d.sessionEnd,
    callRatePerHour: d.callRatePerHour,
    model: d.consultModel,
  }));
}

export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function realMinute() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

export function clockNow(c: Clock): number {
  if (c.mode === 'REAL') return realMinute();
  if (c.paused) return c.baseMinute;
  return c.baseMinute + Math.floor(((Date.now() - c.baseMs) / 1000) * c.speed);
}

function fresh(): Stored {
  return {
    rev: 0,
    live: createLiveState(todayIso(), defaultDoctors()),
    clock: { mode: 'REAL', baseMinute: realMinute(), baseMs: Date.now(), speed: 1, paused: false },
    autopilot: { patients: false, doctors: false, desk: false },
    noShow: null,
  };
}

function safeGet(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function read(): Stored {
  const raw = safeGet();
  if (cache && cache.raw === raw) return cache.value;
  let value: Stored;
  try {
    value = raw ? (JSON.parse(raw) as Stored) : fresh();
    if (!value.live || value.live.version !== 1) value = fresh();
    value.live.lastRefresh ??= -Infinity;
    value.autopilot = Object.assign({ patients: false, doctors: false, desk: false }, value.autopilot);
  } catch {
    value = fresh();
  }
  cache = { raw, value };
  return value;
}

function write(s: Stored) {
  s.rev++;
  const raw = JSON.stringify(s);
  try {
    localStorage.setItem(KEY, raw);
  } catch {
    /* storage full or blocked: keep in memory */
  }
  cache = { raw: safeGet() ?? raw, value: s };
  channel?.postMessage(s.rev);
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => e.key === KEY && l();
  window.addEventListener('storage', onStorage);
  const onMsg = () => l();
  channel?.addEventListener('message', onMsg);
  return () => {
    listeners.delete(l);
    window.removeEventListener('storage', onStorage);
    channel?.removeEventListener('message', onMsg);
  };
}

/** Apply a change to the clinic, re-plan, persist and broadcast. */
export function dispatch(fn: (live: LiveState, now: number, s: Stored) => void) {
  const s = structuredClone(read());
  const now = clockNow(s.clock);
  fn(s.live, now, s);
  refresh(s.live, now);
  write(s);
}

/** Change settings (clock, autopilot, models) without a clinic action. */
export function update(fn: (s: Stored) => void) {
  const s = structuredClone(read());
  fn(s);
  write(s);
}

export function useStore(): Stored {
  return useSyncExternalStore(subscribe, read, read);
}

/** Re-render every second with the clinic clock's current minute. */
export function useNow(): number {
  const s = useStore();
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((x) => x + 1), 500);
    return () => clearInterval(id);
  }, []);
  return clockNow(s.clock);
}

// ---------------------------------------------------------------------------
// New day / sample data
// ---------------------------------------------------------------------------

export function startNewDay(opts: { sample: boolean; demoClock: boolean; seed?: number }) {
  const s = fresh();
  s.noShow = read().noShow; // keep imported real-data models
  if (opts.demoClock) {
    s.clock = { mode: 'DEMO', baseMinute: 7 * 60 + 30, baseMs: Date.now(), speed: 1, paused: false };
    s.autopilot = { patients: true, doctors: true, desk: true };
  }
  const now = clockNow(s.clock);
  if (opts.sample) {
    const day = generateClinicDay(opts.seed ?? 42);
    const ordered = [...day.patients].sort((a, b) => a.bookedAt - b.bookedAt);
    for (const p of ordered) {
      book(
        s.live,
        {
          name: p.name,
          phone: p.phone,
          doctorId: p.doctorId,
          travelMinutes: p.travelMinutes,
          notBefore: p.constraints.notBefore,
          source: 'SAMPLE',
          bookedAtMs: Date.now() + p.bookedAt * 60000,
        },
        Math.min(now, 7 * 60),
      );
    }
  }
  s.live.events.push({ seq: s.live.seq++, t: now, type: 'DAY_END', message: opts.sample ? 'New clinic day opened with sample bookings' : 'New clinic day opened' });
  refresh(s.live, now);
  write(s);
}

// ---------------------------------------------------------------------------
// Leader tab: the clinic clock
// ---------------------------------------------------------------------------

let leaderStarted = false;

export function useClinicClock() {
  useEffect(() => {
    if (leaderStarted) return;
    leaderStarted = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    const run = () => {
      timer = setInterval(() => {
        const s = read();
        const now = clockNow(s.clock);
        if (now === s.live.lastRefresh) return;
        dispatch((live, t, st) => autopilot(live, t, st.autopilot));
      }, 400);
    };
    if (navigator.locks?.request) {
      navigator.locks.request('tarmac-clock', () => {
        run();
        return new Promise(() => {}); // hold the lock for this tab's lifetime
      });
    } else run();
    return () => {
      if (timer) clearInterval(timer);
    };
  }, []);
}
