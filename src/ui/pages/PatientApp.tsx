import { useState, type ReactNode } from 'react';
import {
  book,
  checkIn,
  fmtTime,
  isPending,
  markOnTheWay,
  positionInLine,
  setExchange,
  slotLengthMinutes,
  slotStartOf,
  vacate,
  type ExchangePreference,
  type LivePatient,
  type LiveState,
} from '../../engine';
import { Btn, Field, Input, Kicker, Select, STATUS, statusKey } from '../live/kit';
import { dispatch, useNow, useStore } from '../live/store';
import { EVENT_STYLE } from '../visual';

const ME_KEY = 'tarmac.me';
const getMe = () => {
  try {
    return localStorage.getItem(ME_KEY);
  } catch {
    return null;
  }
};
const setMe = (id: string | null) => {
  try {
    if (id) localStorage.setItem(ME_KEY, id);
    else localStorage.removeItem(ME_KEY);
  } catch {
    /* ignore */
  }
};

export function PatientApp({ param }: { param: string | null }) {
  const s = useStore();
  const [me, setMeState] = useState<string | null>(() => param ?? getMe());
  const choose = (id: string | null) => {
    setMe(id);
    setMeState(id);
  };
  const p = me ? s.live.patients.find((x) => x.id === me) : undefined;

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-8">
      <div className="grid items-start gap-10 lg:grid-cols-[1fr_420px_1fr]">
        <aside className="hidden lg:block">
          <Kicker>Patient app</Kicker>
          <h1 className="mt-2 font-pixel text-3xl uppercase leading-tight">Your visit, without the waiting room</h1>
          <p className="mt-4 text-sm leading-relaxed text-ink/80">
            We watch the doctor’s queue for you and tell you when to leave home. If the doctor runs late, your leave time moves too — you’ll
            never sit in a corridor for hours.
          </p>
        </aside>
        <Phone>{p ? <MyVisit p={p} live={s.live} onReset={() => choose(null)} /> : <BookFlow onBooked={choose} />}</Phone>
        <aside className="hidden text-sm text-ink/80 lg:block">
          <Kicker>How your leave time is worked out</Kicker>
          <ol className="mt-3 list-decimal space-y-2 pl-4">
            <li>Your slot is fixed by when you booked — nobody can push you back.</li>
            <li>We simulate the rest of the doctor’s day hundreds of times using how long their visits really take.</li>
            <li>We pick an early estimate of when you’ll be called, subtract your travel time and a small buffer.</li>
            <li>If anything changes — a delay, an emergency, a cancellation — your time updates instantly.</li>
          </ol>
        </aside>
      </div>
    </div>
  );
}

function Phone({ children }: { children: ReactNode }) {
  const now = useNow();
  return (
    <div className="mx-auto w-full max-w-[420px] rounded-[40px] bg-ink p-3 pixel-shadow">
      <div className="min-h-[720px] overflow-hidden rounded-[30px] bg-paper">
        <div className="flex items-center justify-between px-6 pt-3 text-[11px] text-mute">
          <span className="tabular-nums">{fmtTime(now)}</span>
          <span className="h-5 w-20 rounded-full bg-ink" />
          <span>TARMAC</span>
        </div>
        <div className="px-6 pb-6 pt-5">{children}</div>
      </div>
    </div>
  );
}

function nextSlotPreview(live: LiveState, doctorId: string, now: number, travel: number) {
  const d = live.doctors.find((x) => x.id === doctorId)!;
  const slots = live.slots[doctorId];
  const len = slotLengthMinutes(d.callRatePerHour);
  const prev = slots[slots.length - 1]?.scheduledStart ?? -Infinity;
  return Math.round(Math.max(d.sessionStart + slots.length * len, prev + len, Math.ceil((now + travel) / 5) * 5));
}

function BookFlow({ onBooked }: { onBooked: (id: string) => void }) {
  const s = useStore();
  const now = useNow();
  const [mode, setMode] = useState<'book' | 'find'>('book');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [doctorId, setDoctorId] = useState(s.live.doctors[0]?.id ?? '');
  const [travel, setTravel] = useState(30);
  const [notBefore, setNotBefore] = useState('');
  const [find, setFind] = useState('');
  const [err, setErr] = useState('');
  const slot = doctorId ? nextSlotPreview(s.live, doctorId, now, travel) : null;

  const submit = () => {
    if (!name.trim()) return setErr('Please enter your name.');
    let id = '';
    const nb = notBefore ? Number(notBefore.split(':')[0]) * 60 + Number(notBefore.split(':')[1]) : undefined;
    dispatch((live, t) => {
      id = book(live, { name, phone, doctorId, travelMinutes: travel, notBefore: nb, source: 'APP', bookedAtMs: Date.now() }, t).id;
    });
    onBooked(id);
  };

  const lookup = () => {
    const q = find.trim().toLowerCase().replace(/^t/, '');
    const hit = s.live.patients.find((p) => String(p.token) === q || (p.phone && p.phone.replace(/\D/g, '').endsWith(q.replace(/\D/g, '')) && q.length >= 4));
    if (!hit) return setErr('No booking found for that token or phone number today.');
    onBooked(hit.id);
  };

  return (
    <div>
      <div className="grid grid-cols-2 border border-ink text-sm">
        {(['book', 'find'] as const).map((m) => (
          <button key={m} onClick={() => (setMode(m), setErr(''))} className={`h-10 ${mode === m ? 'bg-ink text-paper' : ''}`}>
            {m === 'book' ? 'Book a visit' : 'Find my booking'}
          </button>
        ))}
      </div>
      {mode === 'book' ? (
        <div className="mt-5 space-y-4">
          <Field label="Your name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Priya Sharma" autoComplete="name" />
          </Field>
          <Field label="Mobile number" hint="We’ll text you when to leave home.">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98xxx xxxxx" inputMode="tel" autoComplete="tel" />
          </Field>
          <Field label="Doctor">
            <Select value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
              {s.live.doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} — {d.specialty}
                </option>
              ))}
            </Select>
          </Field>
          <div>
            <span className="text-xs font-medium">How long does it take you to get here?</span>
            <div className="mt-1 grid grid-cols-6 gap-1">
              {[10, 20, 30, 45, 60, 90].map((m) => (
                <button key={m} onClick={() => setTravel(m)} className={`h-10 border text-xs ${travel === m ? 'border-ink bg-ink text-paper' : 'border-rule'}`}>
                  {m}m
                </button>
              ))}
            </div>
          </div>
          <Field label="I can’t come before (optional)">
            <Input type="time" value={notBefore} onChange={(e) => setNotBefore(e.target.value)} />
          </Field>
          {slot !== null && (
            <div className="border border-dashed border-ink px-3 py-2 text-sm">
              Next available slot: <b>{fmtTime(slot)}</b>
            </div>
          )}
          {err && <div className="text-sm text-c-red">{err}</div>}
          <Btn variant="primary" size="lg" className="w-full" onClick={submit}>
            Confirm booking
          </Btn>
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          <Field label="Token number or mobile number">
            <Input value={find} onChange={(e) => setFind(e.target.value)} placeholder="e.g. 14 or 98765 43210" onKeyDown={(e) => e.key === 'Enter' && lookup()} />
          </Field>
          {err && <div className="text-sm text-c-red">{err}</div>}
          <Btn variant="primary" size="lg" className="w-full" onClick={lookup}>
            Find my visit
          </Btn>
          {s.live.patients.length > 0 && (
            <div>
              <Kicker>Demo shortcut — open any of today’s patients</Kicker>
              <Select className="mt-1" value="" onChange={(e) => e.target.value && onBooked(e.target.value)}>
                <option value="">Choose a patient…</option>
                {s.live.patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    Token {p.token} · {p.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MyVisit({ p, live, onReset }: { p: LivePatient; live: LiveState; onReset: () => void }) {
  const now = useNow();
  const d = live.doctors.find((x) => x.id === p.doctorId)!;
  const slot = slotStartOf(live, p);
  const pos = positionInLine(live, p);
  const key = statusKey(p);
  const st = STATUS[key];
  const feed = live.events
    .filter((e) => e.patientId === p.id || (e.type === 'SWAP' && [(e.data as { a: string }).a, (e.data as { b: string }).b].includes(p.id)))
    .slice(-6)
    .reverse();

  let title: ReactNode = '';
  let sub = '';
  switch (key) {
    case 'BOOKED':
      title = <>Leave home at {p.advisedDeparture !== null ? fmtTime(p.advisedDeparture) : '—'}</>;
      sub = 'Relax — we’ll ping you when it’s time to go.';
      break;
    case 'LEAVE_NOW':
      title = <span className="blink">Time to leave</span>;
      sub = `Head out now — you’re ${p.travelMinutes} min away.`;
      break;
    case 'EN_ROUTE':
      title = <>On your way</>;
      sub = `Expected at the clinic ${p.eta !== null ? fmtTime(p.eta) : ''}. ${pos > 1 ? `${pos - 1} ahead of you.` : 'You’re next.'}`;
      break;
    case 'WAITING':
    case 'EMERGENCY':
      title = pos <= 1 ? <>You’re next</> : <>You’re #{pos}</>;
      sub = `Please wait near ${d.room}. Watch the screen for token ${p.token}.`;
      break;
    case 'IN_CONSULT':
      title = <>Go to {d.room}</>;
      sub = `${d.name} is ready for you.`;
      break;
    case 'DONE':
      title = <>All done</>;
      sub = p.calledAt !== null && p.checkedInAt !== null ? `You waited ${p.calledAt - p.checkedInAt} min in the clinic. Get well soon!` : 'Get well soon!';
      break;
    default:
      title = <>{p.status === 'CANCELLED' ? 'Cancelled' : 'Missed visit'}</>;
      sub = 'Your slot was given to someone who could make it.';
  }

  const act = (fn: (l: LiveState, t: number) => void) => dispatch(fn);
  const swaps = live.patients.filter(
    (q) =>
      q.doctorId === p.doctorId &&
      q.id !== p.id &&
      q.optIn &&
      isPending(q) &&
      q.preference === (p.preference === 'PREFER_EARLIER' ? 'PREFER_LATER' : 'PREFER_EARLIER'),
  ).length;

  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <Kicker>Token</Kicker>
          <div className="font-pixel text-5xl leading-none">{String(p.token).padStart(2, '0')}</div>
        </div>
        <div className="text-right">
          <div className="text-sm font-semibold">{p.name}</div>
          <div className="text-xs text-mute">
            {d.name} · {d.room}
          </div>
        </div>
      </div>

      <div className="mt-5 p-4" style={{ background: st.color, color: st.text }}>
        <div className="font-pixel text-[28px] uppercase leading-[1.05]">{title}</div>
        <div className="mt-2 text-sm opacity-90">{sub}</div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Mini label="Slot" value={slot !== null ? fmtTime(slot) : '—'} />
        <Mini label="In line" value={isPending(p) ? `#${pos}` : '—'} />
        <Mini label="Doctor delay" value={d.delayMinutes ? `${d.delayMinutes}m` : 'none'} />
      </div>

      {p.prediction && isPending(p) && (
        <div className="mt-3 text-xs text-mute">
          Likely to be called between <b className="text-ink">{fmtTime(p.prediction.p10)}</b> and <b className="text-ink">{fmtTime(p.prediction.p90)}</b>
        </div>
      )}

      <div className="mt-4 grid gap-2">
        {p.status === 'BOOKED' && (
          <Btn variant="primary" size="lg" onClick={() => act((l, t) => markOnTheWay(l, p.id, t))}>
            I’m leaving now
          </Btn>
        )}
        {(p.status === 'BOOKED' || p.status === 'EN_ROUTE') && (
          <Btn size="md" onClick={() => act((l, t) => checkIn(l, p.id, t))}>
            I’ve arrived — check me in
          </Btn>
        )}
      </div>

      {p.kind === 'ROUTINE' && isPending(p) && (
        <div className="mt-5 border-t border-dashed border-rule pt-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">Flexible on time?</div>
              <div className="text-xs text-mute">Swap slots with another patient — only if you both win.</div>
            </div>
            <button
              onClick={() => act((l, t) => setExchange(l, p.id, !p.optIn, p.preference === 'NO_PREFERENCE' ? 'PREFER_LATER' : p.preference, t))}
              className={`h-7 w-12 shrink-0 border border-ink p-0.5 ${p.optIn ? 'bg-ink' : ''}`}
              aria-label="Join slot exchange"
            >
              <span className={`block h-full w-5 transition-transform ${p.optIn ? 'translate-x-5 bg-paper' : 'bg-ink'}`} />
            </button>
          </div>
          {p.optIn && (
            <>
              <div className="mt-3 grid grid-cols-2 gap-1.5">
                {(['PREFER_EARLIER', 'PREFER_LATER'] as ExchangePreference[]).map((pref) => (
                  <button
                    key={pref}
                    onClick={() => act((l, t) => setExchange(l, p.id, true, pref, t))}
                    className={`h-10 border text-sm ${p.preference === pref ? 'border-ink bg-ink text-paper' : 'border-rule'}`}
                  >
                    {pref === 'PREFER_EARLIER' ? '↑ I’d like earlier' : '↓ I can come later'}
                  </button>
                ))}
              </div>
              <div className="mt-2 text-xs text-mute">
                {swaps ? `${swaps} patient(s) want the opposite — a swap happens automatically if it suits you both.` : 'Looking for a match…'}
              </div>
            </>
          )}
        </div>
      )}

      <div className="mt-5 border-t border-dashed border-rule pt-4">
        <Kicker>Updates</Kicker>
        <div className="mt-2 space-y-1.5">
          {feed.map((e) => (
            <div key={e.seq} className="flex gap-2 text-xs">
              <span className="shrink-0 tabular-nums text-mute">{fmtTime(e.t)}</span>
              <span className="shrink-0 font-semibold" style={{ color: EVENT_STYLE[e.type]?.color }}>
                {EVENT_STYLE[e.type]?.tag ?? e.type}
              </span>
              <span className="min-w-0">{e.message.replace(/^Token \d+ — /, '')}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-5 flex justify-between border-t border-dashed border-rule pt-4 text-xs">
        <button onClick={onReset} className="underline">
          Book another visit
        </button>
        {isPending(p) && p.kind === 'ROUTINE' && (
          <button className="text-c-red underline" onClick={() => confirm('Cancel this appointment?') && act((l, t) => vacate(l, p.id, 'CANCELLED', t))}>
            Cancel appointment
          </button>
        )}
      </div>
      <div className="sr-only">{now}</div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-rule py-2">
      <div className="font-pixel text-sm">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-mute">{label}</div>
    </div>
  );
}
