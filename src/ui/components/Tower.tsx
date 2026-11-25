import { useState } from 'react';
import { fmtTime, PENDING, type Doctor, type DoctorRuntime, type RuntimePatient, type Slot } from '../../engine';
import type { SimApi } from '../useSimulation';
import { PHASE, initials, phaseOf, type Phase } from '../visual';

const EMERGENCY_NAMES = ['Sunil Gawande', 'Farida Shaikh', 'Prakash Dhote', 'Hema Lanjewar', 'Irfan Sheikh'];

export function Tower({ api, selected, onSelect }: { api: SimApi; selected: string | null; onSelect: (id: string) => void }) {
  const { sim } = api;
  const [hover, setHover] = useState<string | null>(null);
  const hovered = hover ? sim.patients.get(hover) : null;

  return (
    <div>
      <Legend />
      <div className="mt-5 grid gap-6">
        {sim.day.doctors.map((d) => (
          <Lane key={d.id} api={api} def={d} doc={sim.doctors.get(d.id)!} selected={selected} onSelect={onSelect} onHover={setHover} />
        ))}
      </div>
      <div className="mt-3 min-h-[22px] text-xs text-mute">
        {hovered ? <HoverLine p={hovered} slotStart={hovered.slotIndex !== null ? sim.slots[hovered.doctorId][hovered.slotIndex]?.scheduledStart : null} /> : 'Hover a container to inspect it · click to open that patient’s view'}
      </div>
    </div>
  );
}

function HoverLine({ p, slotStart }: { p: RuntimePatient; slotStart: number | null | undefined }) {
  const ph = phaseOf(p);
  return (
    <span className="text-ink">
      <b>{p.name}</b> · {p.id} · {PHASE[ph].label}
      {slotStart != null && <> · slot {fmtTime(slotStart)}</>}
      {p.advisedDeparture !== null && p.status === 'BOOKED' && <> · leave home {fmtTime(p.advisedDeparture)}</>}
      {p.prediction && PENDING.has(p.status) && (
        <> · predicted start {fmtTime(p.prediction.p10)}–{fmtTime(p.prediction.p90)}</>
      )}
      {p.consultStart !== null && p.arrivedAt !== null && <> · waited {p.consultStart - p.arrivedAt} min</>}
    </span>
  );
}

function Legend() {
  const order: Phase[] = ['HOLDING', 'LEAVE_NOW', 'EN_ROUTE', 'WAITING', 'IN_CONSULT', 'DONE', 'EMERGENCY'];
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px]">
      {order.map((ph) => (
        <span key={ph} className="flex items-center gap-1.5">
          <span className="container-box inline-block h-3.5 w-6" style={{ background: PHASE[ph].color }} />
          {PHASE[ph].label}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-3.5 w-6 border border-dashed border-mute" />
        Vacated slot
      </span>
    </div>
  );
}

function Lane({
  api,
  def,
  doc,
  selected,
  onSelect,
  onHover,
}: {
  api: SimApi;
  def: Doctor;
  doc: DoctorRuntime;
  selected: string | null;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
}) {
  const { sim, act } = api;
  const slots = sim.slots[def.id];
  const mine = [...sim.patients.values()].filter((p) => p.doctorId === def.id);
  const emergencies = mine.filter((p) => p.kind === 'EMERGENCY');
  const current = doc.currentPatientId ? sim.patients.get(doc.currentPatientId) : null;
  const count = (ph: Phase[]) => mine.filter((p) => ph.includes(phaseOf(p))).length;
  const model = def.consultModel;

  let status: string;
  if (!doc.started) status = sim.t < doc.knownStart ? `Arrives ${fmtTime(doc.knownStart)}` : `Late — expected ${fmtTime(Math.max(doc.knownStart, sim.t))}`;
  else if (current) status = `With ${current.name} · ${sim.t - (doc.consultStartedAt ?? sim.t)}m`;
  else if (sim.t < doc.unavailableUntil) status = `On break until ${fmtTime(doc.unavailableUntil)}`;
  else if (mine.some((p) => PENDING.has(p.status))) status = 'Idle — waiting for next patient';
  else status = 'Session complete';

  const disabled = sim.finished;
  const small = 'h-7 border border-ink px-2 text-[11px] hover:bg-ink hover:text-paper disabled:opacity-30';

  return (
    <section className="border border-ink bg-paper">
      {/* header */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-ink px-4 py-3">
        <div className="min-w-[220px]">
          <div className="font-pixel text-sm uppercase">{def.name}</div>
          <div className="text-[11px] text-mute">
            {def.specialty} · {fmtTime(def.sessionStart)}–{fmtTime(def.sessionEnd)} · consult median {model.median().toFixed(1)}m, p90 {model.percentile(0.9).toFixed(1)}m
            {model.sigma > 0.45 && <span className="ml-1 bg-ink px-1 text-paper">LONG TAIL</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className={`inline-block h-2 w-2 ${current ? 'bg-c-green' : doc.started ? 'bg-c-orange' : 'bg-mute'}`} />
          {status}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="font-pixel text-[10px] uppercase text-mute">Call rate</span>
          <button className={small} disabled={disabled || doc.callRatePerHour <= 2} onClick={() => act({ type: 'SET_CALL_RATE', doctorId: def.id, perHour: doc.callRatePerHour - 1 })}>
            −
          </button>
          <span className="w-12 text-center text-sm tabular-nums">{doc.callRatePerHour}/h</span>
          <button className={small} disabled={disabled || doc.callRatePerHour >= 12} onClick={() => act({ type: 'SET_CALL_RATE', doctorId: def.id, perHour: doc.callRatePerHour + 1 })}>
            +
          </button>
          <button className={small} disabled={disabled} onClick={() => act({ type: 'DOCTOR_DELAY', doctorId: def.id, minutes: 15 })}>
            Delay +15m
          </button>
          <button
            className={`${small} border-c-pink text-c-pink hover:bg-c-pink hover:text-white`}
            disabled={disabled}
            onClick={() =>
              act({
                type: 'EMERGENCY',
                name: EMERGENCY_NAMES[sim.patients.size % EMERGENCY_NAMES.length],
                consultMinutes: 18,
                doctorId: def.id,
              })
            }
          >
            + Emergency
          </button>
        </div>
      </div>

      {/* the ship */}
      <div className="sea relative overflow-hidden px-4 py-5">
        <div className="wake pointer-events-none absolute inset-0 opacity-40" style={{ backgroundImage: 'repeating-linear-gradient(180deg, rgba(255,255,255,0.06) 0 1px, transparent 1px 18px)' }} />
        <div className="relative flex gap-4">
          {/* priority bay for emergencies */}
          <div className="deck hidden w-[92px] shrink-0 flex-col gap-1.5 p-2 sm:flex">
            <div className="font-pixel text-[9px] uppercase tracking-wider text-white/60">Priority bay</div>
            {emergencies.filter((e) => e.status !== 'DONE').length === 0 && <div className="text-[10px] text-white/35">clear</div>}
            {emergencies
              .filter((e) => e.status !== 'DONE')
              .map((e) => (
                <Box key={e.id} p={e} label={e.status === 'IN_CONSULT' ? 'NOW' : 'EMRG'} selected={selected === e.id} onSelect={onSelect} onHover={onHover} />
              ))}
          </div>
          {/* slot deck */}
          <div className="deck flex-1 p-2.5">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(60px,1fr))] gap-1.5">
              {slots.map((s) => (
                <SlotBox key={s.index} slot={s} api={api} selected={selected} onSelect={onSelect} onHover={onHover} now={sim.t} />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* counts */}
      <div className="grid grid-cols-3 divide-x divide-rule border-t border-ink text-center text-[11px] sm:grid-cols-6">
        {(
          [
            ['At home', ['HOLDING', 'LEAVE_NOW']],
            ['En route', ['EN_ROUTE']],
            ['In waiting room', ['WAITING', 'EMERGENCY']],
            ['With doctor', ['IN_CONSULT']],
            ['Done', ['DONE']],
            ['No-show / cancel', ['GONE']],
          ] as [string, Phase[]][]
        ).map(([label, ph]) => (
          <div key={label} className="px-2 py-2">
            <div className={`font-pixel text-lg leading-none ${label === 'In waiting room' ? 'text-c-red' : ''}`}>{count(ph)}</div>
            <div className="mt-1 text-mute">{label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function SlotBox({
  slot,
  api,
  selected,
  onSelect,
  onHover,
  now,
}: {
  slot: Slot;
  api: SimApi;
  selected: string | null;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  now: number;
}) {
  if (!slot.patientId) {
    return (
      <div className="flex h-[44px] flex-col items-center justify-center border border-dashed border-white/35 text-[9px] text-white/45" title="Vacated slot">
        <span>{fmtTime(slot.scheduledStart)}</span>
        <span>empty</span>
      </div>
    );
  }
  const p = api.sim.patients.get(slot.patientId)!;
  const past = slot.scheduledStart < now;
  return <Box p={p} label={fmtTime(slot.scheduledStart)} selected={selected === p.id} onSelect={onSelect} onHover={onHover} dimLabel={past} />;
}

function Box({
  p,
  label,
  selected,
  onSelect,
  onHover,
  dimLabel,
}: {
  p: RuntimePatient;
  label: string;
  selected: boolean;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  dimLabel?: boolean;
}) {
  const ph = phaseOf(p);
  const st = PHASE[ph];
  const done = ph === 'DONE';
  const swapped = p.originalSlotIndex !== null && p.slotIndex !== null && p.slotIndex !== p.originalSlotIndex;
  return (
    <button
      onClick={() => onSelect(p.id)}
      onMouseEnter={() => onHover(p.id)}
      onMouseLeave={() => onHover(null)}
      className={`container-box relative flex h-[44px] w-full flex-col items-center justify-center transition-transform duration-300 hover:-translate-y-0.5 ${
        selected ? 'outline-2 outline-offset-2 outline-white' : ''
      } ${ph === 'IN_CONSULT' ? 'ring-2 ring-c-green/60 ring-offset-2 ring-offset-[#22314f]' : ''}`}
      style={{ background: st.color, color: st.text, opacity: done ? 0.55 : 1 }}
      title={`${p.name} — ${st.label}`}
    >
      <span className="font-pixel text-[13px] leading-none">{initials(p.name)}</span>
      <span className={`mt-1 text-[9px] leading-none ${dimLabel ? 'opacity-60' : 'opacity-90'}`}>{label}</span>
      {swapped && <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 bg-white" title="Moved from original slot" />}
      {ph === 'LEAVE_NOW' && <span className="blink absolute left-0.5 top-0.5 h-1.5 w-1.5 bg-white" />}
    </button>
  );
}
