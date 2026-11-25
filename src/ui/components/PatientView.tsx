import type { ReactNode } from 'react';
import { fmtTime, PENDING, type EngineEvent, type ExchangePreference, type RuntimePatient } from '../../engine';
import type { SimApi } from '../useSimulation';
import { EVENT_STYLE, PHASE, fmtDur, phaseOf } from '../visual';

const PATIENT_EVENTS = new Set(['ADVISORY', 'REVISED_ADVISORY', 'LEAVE_NOW', 'DEPARTED', 'ARRIVED', 'CONSULT_STARTED', 'CONSULT_ENDED', 'COMPRESSION', 'SWAP', 'NO_SHOW_DECLARED', 'CANCELLED', 'EXCHANGE_OPT_IN', 'LATE_ARRIVAL_BYPASS']);

function involves(e: EngineEvent, id: string) {
  if (e.patientId === id) return true;
  if (e.type === 'SWAP') {
    const d = e.data as { a: string; b: string };
    return d.a === id || d.b === id;
  }
  return false;
}

export function PatientView({ api, patientId, onSelect }: { api: SimApi; patientId: string | null; onSelect: (id: string) => void }) {
  const { sim } = api;
  const all = [...sim.patients.values()];
  const p = (patientId && sim.patients.get(patientId)) || all[0];

  return (
    <div className="grid gap-8 lg:grid-cols-[380px_1fr]">
      <Phone api={api} p={p} />
      <div className="min-w-0">
        <label className="block">
          <span className="font-pixel text-[10px] uppercase tracking-wider text-mute">Viewing as</span>
          <select value={p.id} onChange={(e) => onSelect(e.target.value)} className="mt-1 block h-10 w-full border border-ink bg-paper px-2 text-sm">
            {sim.day.doctors.map((d) => (
              <optgroup key={d.id} label={`${d.name} — ${d.specialty}`}>
                {all
                  .filter((x) => x.doctorId === d.id)
                  .sort((a, b) => (a.slotIndex ?? -1) - (b.slotIndex ?? -1))
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.kind === 'EMERGENCY' ? '⚠ ' : ''}
                      {x.id} · {x.name}
                      {x.slotIndex !== null ? ` · slot ${fmtTime(sim.slots[x.doctorId][x.slotIndex].scheduledStart)}` : ''} · {PHASE[phaseOf(x)].label}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        <Journey api={api} p={p} />
        <YouVsBaseline api={api} p={p} />
        <ClinicActions api={api} p={p} />
      </div>
    </div>
  );
}

function Phone({ api, p }: { api: SimApi; p: RuntimePatient }) {
  const { sim, act } = api;
  const doctor = sim.day.doctors.find((d) => d.id === p.doctorId)!;
  const slot = p.slotIndex !== null ? sim.slots[p.doctorId][p.slotIndex] : null;
  const ph = phaseOf(p);
  const ahead = [...sim.patients.values()].filter(
    (q) =>
      q.doctorId === p.doctorId &&
      q.id !== p.id &&
      PENDING.has(q.status) &&
      (q.kind === 'EMERGENCY' ? q.status === 'WAITING' : q.slotIndex !== null && p.slotIndex !== null && q.slotIndex < p.slotIndex),
  ).length;
  const feed = sim.events.filter((e) => PATIENT_EVENTS.has(e.type) && involves(e, p.id)).slice(-8).reverse();

  let headline: ReactNode;
  let sub = '';
  switch (ph) {
    case 'HOLDING':
      headline = <>Leave home at <span className="whitespace-nowrap">{p.advisedDeparture !== null ? fmtTime(p.advisedDeparture) : '—'}</span></>;
      sub = `Stay home — we’ll ping you. ${p.travelMinutes} min travel.`;
      break;
    case 'LEAVE_NOW':
      headline = <span className="blink">Leave now</span>;
      sub = `Doctor expected around ${p.prediction ? fmtTime(p.prediction.p50) : '—'}.`;
      break;
    case 'EN_ROUTE':
      headline = <>On the way</>;
      sub = `ETA ${p.eta !== null ? fmtTime(p.eta) : '—'} · ${ahead} ahead of you`;
      break;
    case 'WAITING':
    case 'EMERGENCY':
      headline = <>You’re #{ahead + 1}</>;
      sub = `In the waiting room for ${sim.t - (p.arrivedAt ?? sim.t)} min`;
      break;
    case 'IN_CONSULT':
      headline = <>With doctor</>;
      sub = `Called after ${p.consultStart! - p.arrivedAt!} min in clinic`;
      break;
    case 'DONE':
      headline = <>All done</>;
      sub = `Time in clinic before your consult: ${p.consultStart! - p.arrivedAt!} min`;
      break;
    default:
      headline = <>{p.status === 'NO_SHOW' ? 'Marked no-show' : 'Cancelled'}</>;
      sub = 'Your slot was released to the next patient who could make it.';
  }

  const setPref = (pref: ExchangePreference, optIn = true) =>
    act({ type: 'SET_EXCHANGE', patientId: p.id, optIn, preference: pref, maxShiftMinutes: Math.max(90, p.exchange.maxShiftMinutes) });
  const counterpart =
    p.exchange.preference === 'PREFER_EARLIER' ? 'PREFER_LATER' : p.exchange.preference === 'PREFER_LATER' ? 'PREFER_EARLIER' : null;
  const counterparts = counterpart
    ? [...sim.patients.values()].filter((q) => q.doctorId === p.doctorId && q.exchange.optIn && q.exchange.preference === counterpart && PENDING.has(q.status)).length
    : 0;
  const swaps = sim.events.filter((e) => e.type === 'SWAP' && involves(e, p.id));

  return (
    <div className="mx-auto w-full max-w-[380px] rounded-[38px] bg-ink p-3 pixel-shadow">
      <div className="overflow-hidden rounded-[28px] bg-paper">
        <div className="flex items-center justify-between px-5 pt-3 text-[10px] text-mute">
          <span>{fmtTime(sim.t)}</span>
          <span className="h-4 w-16 rounded-full bg-ink" />
          <span>TARMAC</span>
        </div>
        <div className="px-5 pb-5 pt-4">
          <div className="text-[11px] uppercase tracking-wider text-mute">
            {p.id} · {p.kind === 'EMERGENCY' ? 'Emergency' : doctor.specialty}
          </div>
          <div className="text-lg font-semibold leading-tight">{p.name}</div>
          <div className="text-xs text-mute">{doctor.name}</div>

          <div className="mt-4 border border-ink p-3" style={{ background: ph === 'LEAVE_NOW' ? PHASE.LEAVE_NOW.color : undefined, color: ph === 'LEAVE_NOW' ? '#fff' : undefined }}>
            <div className="font-pixel text-[26px] leading-[1.05] uppercase">{headline}</div>
            <div className="mt-1.5 text-xs opacity-80">{sub}</div>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <Stat label="My slot" value={slot ? fmtTime(slot.scheduledStart) : '—'} />
            <Stat label="Position" value={PENDING.has(p.status) ? `#${ahead + 1}` : '—'} />
            <Stat label="Travel" value={`${p.travelMinutes}m`} />
          </div>

          {p.prediction && PENDING.has(p.status) && <Band api={api} p={p} slotStart={slot?.scheduledStart ?? null} />}

          {p.kind === 'ROUTINE' && (
            <div className="mt-4 border-t border-dashed border-rule pt-3">
              <div className="flex items-center justify-between">
                <div className="font-pixel text-[11px] uppercase">Slot exchange</div>
                <button
                  disabled={!PENDING.has(p.status) || sim.finished}
                  onClick={() => setPref(p.exchange.preference === 'NO_PREFERENCE' ? 'PREFER_EARLIER' : p.exchange.preference, !p.exchange.optIn)}
                  className={`h-6 w-11 border border-ink p-0.5 disabled:opacity-30 ${p.exchange.optIn ? 'bg-ink' : ''}`}
                  aria-label="Opt in to slot exchange"
                >
                  <span className={`block h-full w-4 transition-transform ${p.exchange.optIn ? 'translate-x-5 bg-paper' : 'bg-ink'}`} />
                </button>
              </div>
              {p.exchange.optIn ? (
                <>
                  <div className="mt-2 grid grid-cols-2 gap-1.5">
                    {(['PREFER_EARLIER', 'PREFER_LATER'] as ExchangePreference[]).map((pref) => (
                      <button
                        key={pref}
                        disabled={!PENDING.has(p.status) || sim.finished}
                        onClick={() => setPref(pref)}
                        className={`h-8 border text-[11px] disabled:opacity-30 ${p.exchange.preference === pref ? 'border-ink bg-ink text-paper' : 'border-rule'}`}
                      >
                        {pref === 'PREFER_EARLIER' ? '↑ Earlier' : '↓ Later'}
                      </button>
                    ))}
                  </div>
                  <div className="mt-2 text-[11px] text-mute">
                    {counterparts > 0
                      ? `${counterparts} patient(s) want the opposite trade — matched only if you’re both better off.`
                      : 'No matching offer yet. You will never be moved unless you’re better off.'}
                  </div>
                </>
              ) : (
                <div className="mt-1.5 text-[11px] text-mute">Off — your slot is yours. Nobody can move you later.</div>
              )}
              {swaps.map((e) => (
                <div key={e.seq} className="mt-2 bg-[#7a3fd0] px-2 py-1.5 text-[11px] text-white">
                  {fmtTime(e.t)} · {e.message}
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 border-t border-dashed border-rule pt-3">
            <div className="font-pixel text-[11px] uppercase">Notifications</div>
            <div className="mt-2 max-h-40 space-y-1.5 overflow-y-auto thin-scroll">
              {feed.length === 0 && <div className="text-[11px] text-mute">Nothing yet.</div>}
              {feed.map((e) => (
                <div key={e.seq} className="flex gap-2 text-[11px] leading-snug">
                  <span className="shrink-0 text-mute">{fmtTime(e.t)}</span>
                  <span className="shrink-0 font-semibold" style={{ color: EVENT_STYLE[e.type]?.color }}>
                    {EVENT_STYLE[e.type]?.tag}
                  </span>
                  <span className="min-w-0">{e.message}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-rule py-1.5">
      <div className="font-pixel text-sm">{value}</div>
      <div className="text-[9px] uppercase tracking-wider text-mute">{label}</div>
    </div>
  );
}

function Band({ api, p, slotStart }: { api: SimApi; p: RuntimePatient; slotStart: number | null }) {
  const pr = p.prediction!;
  const lo = Math.min(pr.p10, slotStart ?? pr.p10, api.sim.t) - 10;
  const hi = Math.max(pr.p90, slotStart ?? pr.p90) + 10;
  const x = (t: number) => `${((t - lo) / (hi - lo)) * 100}%`;
  return (
    <div className="mt-3">
      <div className="flex justify-between text-[10px] uppercase tracking-wider text-mute">
        <span>Predicted start</span>
        <span>
          p10 {fmtTime(pr.p10)} · p50 {fmtTime(pr.p50)} · p90 {fmtTime(pr.p90)}
        </span>
      </div>
      <div className="relative mt-1.5 h-6 border-b border-ink">
        <div className="absolute top-1.5 h-3 bg-ink/15" style={{ left: x(pr.p10), width: `calc(${x(pr.p90)} - ${x(pr.p10)})` }} />
        <div className="absolute top-0.5 h-5 w-[2px] bg-ink" style={{ left: x(pr.p50) }} />
        <div className="absolute top-0.5 h-5 w-[2px] bg-c-blue" style={{ left: x(pr.p10) }} title="Advisory percentile" />
        {slotStart !== null && <div className="absolute -top-1 h-7 border-l border-dashed border-c-red" style={{ left: x(slotStart) }} title="Booked slot" />}
        <div className="absolute -top-1 h-7 w-[2px] bg-c-green" style={{ left: x(api.sim.t) }} title="Now" />
      </div>
      <div className="mt-1 flex gap-3 text-[9px] text-mute">
        <span><i className="inline-block h-2 w-2 bg-c-green align-middle" /> now</span>
        <span><i className="inline-block h-2 w-2 bg-c-blue align-middle" /> advisory (p10)</span>
        <span><i className="inline-block h-2 w-2 border border-dashed border-c-red align-middle" /> booked slot</span>
      </div>
    </div>
  );
}

function Journey({ api, p }: { api: SimApi; p: RuntimePatient }) {
  const first = (type: string) => api.sim.events.find((e) => e.patientId === p.id && e.type === type)?.t ?? null;
  const steps: [string, number | null][] =
    p.kind === 'EMERGENCY'
      ? [
          ['Walked in', p.arrivedAt],
          ['Called', p.consultStart],
          ['Done', p.status === 'DONE' ? p.consultEnd : null],
        ]
      : [
          ['Slot assigned (RBS)', first('SLOT_ASSIGNED')],
          ['First advisory', first('ADVISORY')],
          ['Leave-now ping', p.leaveNowAt],
          ['Left home', p.departedAt],
          ['Arrived', p.arrivedAt],
          ['Called in', p.consultStart],
          ['Done', p.status === 'DONE' ? p.consultEnd : null],
        ];
  return (
    <div className="mt-6">
      <div className="font-pixel text-[11px] uppercase">Journey</div>
      <ol className="mt-3 grid grid-cols-2 gap-px border border-ink bg-rule sm:grid-cols-4 xl:grid-cols-7">
        {steps.map(([label, t]) => (
          <li key={label} className={`px-3 py-2.5 ${t !== null ? 'bg-paper' : 'bg-paper-2 text-mute'}`}>
            <div className="font-pixel text-base">{t !== null ? fmtTime(t) : '··:··'}</div>
            <div className="text-[10px] uppercase tracking-wider">{label}</div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function YouVsBaseline({ api, p }: { api: SimApi; p: RuntimePatient }) {
  const b = api.baseline.patients.find((x) => x.id === p.id);
  const base = b && b.consultStart !== null && b.arrivedAt !== null ? b.consultStart - b.arrivedAt : null;
  const now = p.consultStart !== null && p.arrivedAt !== null ? p.consultStart - p.arrivedAt : null;
  if (p.kind === 'EMERGENCY') return null;
  return (
    <div className="mt-6 grid grid-cols-2 border border-ink">
      <div className="border-r border-ink p-4">
        <div className="font-pixel text-[10px] uppercase text-mute">Today’s reality (“come at 9”)</div>
        <div className="mt-1 font-pixel text-3xl text-c-red">{base !== null ? fmtDur(base) : '—'}</div>
        <div className="text-[11px] text-mute">sitting in the waiting room</div>
      </div>
      <div className="p-4">
        <div className="font-pixel text-[10px] uppercase text-mute">With TARMAC</div>
        <div className="mt-1 font-pixel text-3xl text-c-green">{now !== null ? fmtDur(now) : PENDING.has(p.status) ? '…' : '—'}</div>
        <div className="text-[11px] text-mute">{now !== null ? 'sitting in the waiting room' : PENDING.has(p.status) ? 'day in progress' : 'not seen'}</div>
      </div>
    </div>
  );
}

function ClinicActions({ api, p }: { api: SimApi; p: RuntimePatient }) {
  const can = p.kind === 'ROUTINE' && (p.status === 'BOOKED' || p.status === 'EN_ROUTE') && !api.sim.finished;
  const b = 'h-9 border border-ink px-3 text-xs hover:bg-ink hover:text-paper disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink';
  return (
    <div className="mt-6 flex flex-wrap items-center gap-2">
      <span className="font-pixel text-[10px] uppercase text-mute">Clinic desk</span>
      <button className={b} disabled={!can} onClick={() => api.act({ type: 'MARK_NO_SHOW', patientId: p.id })}>
        Mark no-show
      </button>
      <button className={b} disabled={!can} onClick={() => api.act({ type: 'CANCEL', patientId: p.id })}>
        Patient cancelled
      </button>
      <span className="text-[11px] text-mute">Either one frees the slot and triggers compression.</span>
    </div>
  );
}
