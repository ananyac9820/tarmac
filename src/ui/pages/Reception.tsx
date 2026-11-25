import { useMemo, useState } from 'react';
import {
  addEmergency,
  book,
  checkIn,
  doctorDelay,
  fmtTime,
  isPending,
  setDoctorPresent,
  slotStartOf,
  unresponsive,
  vacate,
  type LivePatient,
  type LiveState,
} from '../../engine';
import { Btn, Card, Empty, Field, Input, Kicker, Select, StatusBadge, statusKey } from '../live/kit';
import { dispatch, useNow, useStore } from '../live/store';
import { href } from '../router';
import { EVENT_STYLE } from '../visual';

const FILTERS: [string, string, (p: LivePatient) => boolean][] = [
  ['all', 'Everyone', () => true],
  ['home', 'At home', (p) => p.status === 'BOOKED'],
  ['road', 'On the way', (p) => p.status === 'EN_ROUTE'],
  ['wait', 'Waiting', (p) => p.status === 'WAITING'],
  ['in', 'With doctor', (p) => p.status === 'IN_CONSULT'],
  ['done', 'Finished', (p) => !isPending(p) && p.status !== 'IN_CONSULT'],
];

export function Reception() {
  const s = useStore();
  const now = useNow();
  const live = s.live;
  const [doc, setDoc] = useState('all');
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [panel, setPanel] = useState<'none' | 'book' | 'emergency'>('none');

  const rows = useMemo(() => {
    const f = FILTERS.find((x) => x[0] === filter)![2];
    const needle = q.trim().toLowerCase();
    return live.patients
      .filter((p) => (doc === 'all' || p.doctorId === doc) && f(p) && (!needle || p.name.toLowerCase().includes(needle) || String(p.token) === needle || p.phone.includes(needle)))
      .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'EMERGENCY' ? -1 : 1) || (slotStartOf(live, a) ?? 0) - (slotStartOf(live, b) ?? 0) || a.token - b.token);
  }, [live, doc, filter, q]);

  const silent = unresponsive(live, now);
  const counts = {
    booked: live.patients.length,
    home: live.patients.filter((p) => p.status === 'BOOKED').length,
    road: live.patients.filter((p) => p.status === 'EN_ROUTE').length,
    wait: live.patients.filter((p) => p.status === 'WAITING').length,
    seen: live.patients.filter((p) => p.status === 'DONE').length,
  };
  const recent = live.events.filter((e) => ['SWAP', 'COMPRESSION', 'REVISED_ADVISORY', 'EMERGENCY_ARRIVED', 'NO_SHOW_DECLARED', 'CANCELLED', 'MODEL_UPDATED', 'DOCTOR_DELAY_ANNOUNCED'].includes(e.type)).slice(-6).reverse();

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Kicker>Reception desk · {live.clinicName}</Kicker>
          <h1 className="mt-1 font-pixel text-3xl uppercase sm:text-4xl">Today</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Btn variant="primary" onClick={() => setPanel(panel === 'book' ? 'none' : 'book')}>
            + New booking / walk-in
          </Btn>
          <Btn variant="danger" onClick={() => setPanel(panel === 'emergency' ? 'none' : 'emergency')}>
            + Emergency
          </Btn>
        </div>
      </div>

      {panel === 'book' && <BookingForm live={live} onDone={() => setPanel('none')} />}
      {panel === 'emergency' && <EmergencyForm live={live} onDone={() => setPanel('none')} />}

      {live.patients.length === 0 && (
        <div className="mt-6">
          <Empty>
            No patients yet today. Add a booking above, have patients book from the <a className="underline" href={href('patient')}>patient app</a>, or open the
            clock menu (top right) to start a demo day.
          </Empty>
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-px border border-ink bg-ink sm:grid-cols-5">
        {[
          ['Booked today', counts.booked],
          ['At home', counts.home],
          ['On the way', counts.road],
          ['In waiting room', counts.wait],
          ['Seen', counts.seen],
        ].map(([l, n]) => (
          <div key={l} className="bg-paper px-4 py-3">
            <div className={`font-pixel text-2xl ${l === 'In waiting room' ? 'text-c-red' : ''}`}>{n}</div>
            <div className="text-xs text-mute">{l}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="min-w-0">
          {/* doctors */}
          <div className="grid gap-3 md:grid-cols-3">
            {live.doctors.map((d) => {
              const cur = d.currentId ? live.patients.find((p) => p.id === d.currentId) : null;
              const onBreak = d.breakUntil !== null && d.breakUntil > now;
              return (
                <Card key={d.id} className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold">{d.name}</div>
                      <div className="text-xs text-mute">
                        {d.specialty} · {d.room}
                      </div>
                    </div>
                    <span className={`mt-1 inline-block h-2.5 w-2.5 shrink-0 ${!d.present ? 'bg-mute' : onBreak ? 'bg-c-orange' : 'bg-c-green'}`} />
                  </div>
                  <div className="mt-2 text-sm">
                    {!d.present
                      ? `Not in yet${d.delayMinutes ? ` · ${d.delayMinutes} min late` : ''}`
                      : onBreak
                        ? `On a break until ${fmtTime(d.breakUntil!)}`
                        : cur
                          ? `Seeing token ${cur.token} · ${now - (d.currentStartedAt ?? now)} min`
                          : 'Free'}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {!d.present && (
                      <Btn size="sm" onClick={() => dispatch((l, t) => setDoctorPresent(l, d.id, true, t))}>
                        Mark arrived
                      </Btn>
                    )}
                    <Btn size="sm" variant="quiet" onClick={() => dispatch((l, t) => doctorDelay(l, d.id, 15, t))}>
                      Running late +15
                    </Btn>
                  </div>
                </Card>
              );
            })}
          </div>

          {/* filters */}
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Select value={doc} onChange={(e) => setDoc(e.target.value)} className="h-9 w-auto text-xs">
              <option value="all">All doctors</option>
              {live.doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
            {FILTERS.map(([k, label]) => (
              <button key={k} onClick={() => setFilter(k)} className={`h-9 border px-3 text-xs ${filter === k ? 'border-ink bg-ink text-paper' : 'border-rule hover:border-ink'}`}>
                {label}
              </button>
            ))}
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, token, phone" className="ml-auto h-9 !w-full text-xs sm:!w-60" />
          </div>

          {/* table */}
          <Card className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-ink text-left text-xs text-mute">
                  <th className="px-3 py-2.5 font-medium">Token</th>
                  <th className="px-3 py-2.5 font-medium">Patient</th>
                  <th className="px-3 py-2.5 font-medium">Doctor</th>
                  <th className="px-3 py-2.5 font-medium">Slot</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Details</th>
                  <th className="px-3 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <Row key={p.id} p={p} live={live} now={now} />
                ))}
              </tbody>
            </table>
            {rows.length === 0 && live.patients.length > 0 && <div className="p-6 text-center text-sm text-mute">No patients match.</div>}
          </Card>
        </div>

        {/* side: alerts */}
        <div className="space-y-6">
          <Card className="p-4">
            <Kicker>Needs attention</Kicker>
            {silent.length === 0 ? (
              <div className="mt-2 text-sm text-mute">All clear.</div>
            ) : (
              <div className="mt-2 space-y-3">
                {silent.map((p) => (
                  <div key={p.id} className="text-sm">
                    <div>
                      <b>Token {p.token}</b> · {p.name} hasn’t responded to “leave now” ({now - p.leaveNowAt!} min)
                    </div>
                    <div className="mt-0.5 text-xs text-mute">{p.phone || 'no phone on file'}</div>
                    <div className="mt-1.5 flex gap-1.5">
                      <Btn size="sm" onClick={() => dispatch((l, t) => checkIn(l, p.id, t))}>
                        They’re here
                      </Btn>
                      <Btn size="sm" variant="danger" onClick={() => dispatch((l, t) => vacate(l, p.id, 'NO_SHOW', t))}>
                        Mark no-show
                      </Btn>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card className="p-4">
            <Kicker>What the system just did</Kicker>
            <div className="mt-2 space-y-2">
              {recent.length === 0 && <div className="text-sm text-mute">Nothing yet.</div>}
              {recent.map((e) => (
                <div key={e.seq} className="text-xs leading-snug">
                  <span className="mr-1.5 tabular-nums text-mute">{fmtTime(e.t)}</span>
                  <span className="mr-1.5 font-semibold" style={{ color: EVENT_STYLE[e.type]?.color }}>
                    {EVENT_STYLE[e.type]?.tag ?? e.type}
                  </span>
                  {e.message}
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ p, live, now }: { p: LivePatient; live: LiveState; now: number }) {
  const d = live.doctors.find((x) => x.id === p.doctorId)!;
  const slot = slotStartOf(live, p);
  const k = statusKey(p);
  let detail = '';
  if (k === 'BOOKED') detail = p.advisedDeparture !== null ? `Leaves home ${fmtTime(p.advisedDeparture)} · ${p.travelMinutes}m away` : '';
  else if (k === 'LEAVE_NOW') detail = `Told to leave ${now - p.leaveNowAt!} min ago`;
  else if (k === 'EN_ROUTE') detail = `ETA ${fmtTime(p.eta!)}`;
  else if (p.status === 'WAITING') detail = `Waiting ${now - (p.checkedInAt ?? now)} min`;
  else if (p.status === 'IN_CONSULT') detail = `In ${d.room} since ${fmtTime(p.calledAt!)}`;
  else if (p.status === 'DONE') detail = `Waited ${(p.calledAt ?? 0) - (p.checkedInAt ?? 0)} min · consult ${(p.doneAt ?? 0) - (p.calledAt ?? 0)} min`;
  const moved = p.originalSlotStart !== null && slot !== null && slot !== p.originalSlotStart;
  return (
    <tr className="border-b border-rule last:border-0 hover:bg-paper-2/60">
      <td className="px-3 py-2 font-pixel tabular-nums">{String(p.token).padStart(2, '0')}</td>
      <td className="px-3 py-2">
        <a href={href('patient', p.id)} className="hover:underline">
          {p.name}
        </a>
        {p.source === 'WALK_IN' && <span className="ml-1.5 text-[10px] text-mute">walk-in</span>}
        {p.optIn && <span className="ml-1.5 text-[10px] text-[#7a3fd0]">swap {p.preference === 'PREFER_EARLIER' ? '↑' : '↓'}</span>}
      </td>
      <td className="px-3 py-2 text-xs">{d.name}</td>
      <td className="px-3 py-2 tabular-nums">
        {slot !== null ? fmtTime(slot) : '—'}
        {moved && <span className="ml-1 text-[10px] text-mute">(was {fmtTime(p.originalSlotStart!)})</span>}
      </td>
      <td className="px-3 py-2">
        <StatusBadge p={p} />
      </td>
      <td className="px-3 py-2 text-xs text-mute">{detail}</td>
      <td className="px-3 py-2">
        <div className="flex justify-end gap-1.5">
          {(p.status === 'BOOKED' || p.status === 'EN_ROUTE') && (
            <>
              <Btn size="sm" onClick={() => dispatch((l, t) => checkIn(l, p.id, t))}>
                Check in
              </Btn>
              <Btn size="sm" variant="quiet" onClick={() => dispatch((l, t) => vacate(l, p.id, 'NO_SHOW', t))}>
                No-show
              </Btn>
            </>
          )}
          {isPending(p) && p.kind === 'ROUTINE' && (
            <Btn size="sm" variant="quiet" onClick={() => confirm(`Cancel token ${p.token}?`) && dispatch((l, t) => vacate(l, p.id, 'CANCELLED', t))}>
              Cancel
            </Btn>
          )}
        </div>
      </td>
    </tr>
  );
}

function BookingForm({ live, onDone }: { live: LiveState; onDone: () => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [doctorId, setDoctorId] = useState(live.doctors[0]?.id ?? '');
  const [travel, setTravel] = useState(30);
  const [walkIn, setWalkIn] = useState(true);
  return (
    <Card className="mt-5 p-5">
      <div className="grid gap-4 md:grid-cols-[1.2fr_1fr_1.2fr_0.8fr_auto] md:items-end">
        <Field label="Patient name">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Mobile">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
        </Field>
        <Field label="Doctor">
          <Select value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
            {live.doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} — {d.specialty}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={walkIn ? 'Here now' : 'Travel (min)'}>
          <Input type="number" min={0} value={walkIn ? 0 : travel} disabled={walkIn} onChange={(e) => setTravel(Number(e.target.value))} />
        </Field>
        <div className="flex gap-2">
          <Btn
            variant="primary"
            disabled={!name.trim()}
            onClick={() => {
              dispatch((l, t) => void book(l, { name, phone, doctorId, travelMinutes: travel, walkIn, source: 'DESK', bookedAtMs: Date.now() }, t));
              onDone();
            }}
          >
            Add
          </Btn>
          <Btn variant="quiet" onClick={onDone}>
            ✕
          </Btn>
        </div>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={walkIn} onChange={(e) => setWalkIn(e.target.checked)} />
        Walk-in (patient is at the desk now — checks them in immediately)
      </label>
    </Card>
  );
}

function EmergencyForm({ live, onDone }: { live: LiveState; onDone: () => void }) {
  const [name, setName] = useState('');
  const [doctorId, setDoctorId] = useState('auto');
  return (
    <Card className="mt-5 border-c-red p-5">
      <div className="grid gap-4 md:grid-cols-[1.4fr_1.2fr_auto] md:items-end">
        <Field label="Emergency patient name">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Doctor">
          <Select value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
            <option value="auto">Least busy doctor</option>
            {live.doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex gap-2">
          <Btn
            variant="danger"
            onClick={() => {
              dispatch((l, t) => void addEmergency(l, name || 'Emergency', doctorId === 'auto' ? null : doctorId, t));
              onDone();
            }}
          >
            Send to front of queue
          </Btn>
          <Btn variant="quiet" onClick={onDone}>
            ✕
          </Btn>
        </div>
      </div>
      <p className="mt-3 text-xs text-mute">Emergencies are seen next. Routine patients who’ve waited a long time still can’t be pushed back indefinitely.</p>
    </Card>
  );
}
