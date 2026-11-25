import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fitNoShowModel, liveModel, toCsv, visitRecords, type RateRow } from '../../engine';
import { Btn, Card, Kicker, download } from '../live/kit';
import { update, useStore } from '../live/store';
import { href } from '../router';

const BAR = '#3071d9';

export function DataPage() {
  const s = useStore();
  const live = s.live;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const records = visitRecords(live);
  const finished = live.patients.filter((p) => p.status === 'DONE');

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setErr('');
    setBusy(true);
    try {
      const text = await f.text();
      const model = fitNoShowModel(text, f.name);
      update((st) => void (st.noShow = model));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not read that file.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-8">
      <Kicker>Data</Kicker>
      <h1 className="mt-1 font-pixel text-3xl uppercase sm:text-4xl">Real data in, real data out</h1>
      <p className="mt-3 max-w-2xl text-sm text-ink/80">
        Every booking, leave-now ping, check-in, call and finish in this clinic is timestamped. Export it any time. Doctors’ consultation models
        re-calibrate from today’s real visits, and you can fit the no-show model on a real appointment history.
      </p>

      {/* today */}
      <section className="mt-8 grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <Card className="p-5">
          <Kicker>Collected today · {live.date}</Kicker>
          <div className="mt-3 grid grid-cols-3 gap-px border border-ink bg-ink">
            {[
              ['Visits recorded', live.patients.length],
              ['Completed', finished.length],
              ['Events logged', live.events.length],
            ].map(([l, n]) => (
              <div key={l} className="bg-paper px-3 py-3">
                <div className="font-pixel text-2xl">{n}</div>
                <div className="text-[11px] text-mute">{l}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Btn variant="primary" disabled={!records.length} onClick={() => download(`tarmac-visits-${live.date}.csv`, toCsv(records))}>
              ⬇ Visits CSV
            </Btn>
            <Btn disabled={!live.events.length} onClick={() => download(`tarmac-events-${live.date}.csv`, toCsv(live.events.map((e) => ({ seq: e.seq, minute: e.t, type: e.type, patient: e.patientId ?? '', doctor: e.doctorId ?? '', message: e.message }))))}>
              ⬇ Event log CSV
            </Btn>
          </div>
          <p className="mt-3 text-[11px] text-mute">
            Columns include booking time, slot, leave-now time, check-in, called, done, wait and consult minutes — the data needed to evaluate and
            re-fit the scheduler on your own clinic.
          </p>
        </Card>
        <Card className="p-5">
          <Kicker>Consultation models, calibrated on real visits</Kicker>
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="border-b border-ink text-left text-xs text-mute">
                <th className="py-2 font-medium">Doctor</th>
                <th className="py-2 text-right font-medium">Real visits</th>
                <th className="py-2 text-right font-medium">Median</th>
                <th className="py-2 text-right font-medium">90% under</th>
              </tr>
            </thead>
            <tbody>
              {live.doctors.map((d) => {
                const m = liveModel(d, live.config.priorWeight);
                return (
                  <tr key={d.id} className="border-b border-rule last:border-0">
                    <td className="py-2">{d.name}</td>
                    <td className="py-2 text-right tabular-nums">{d.observed.length}</td>
                    <td className="py-2 text-right tabular-nums">{m.median().toFixed(1)}m</td>
                    <td className="py-2 text-right tabular-nums">{m.percentile(0.9).toFixed(1)}m</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-3 text-[11px] text-mute">
            Each model starts from the doctor’s history (worth {live.config.priorWeight} visits) and shifts toward what really happens today as
            consultations finish.
          </p>
        </Card>
      </section>

      {/* no-show import */}
      <section className="mt-8">
        <Card className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl">
              <Kicker>Real appointment history → no-show model</Kicker>
              <p className="mt-2 text-sm text-ink/80">
                Upload an appointment log with a no-show column. Works out of the box with the public <b>Medical Appointment No Shows</b> dataset
                on Kaggle (~110,000 real appointments,{' '}
                <a className="underline" href="https://www.kaggle.com/datasets/joniarroba/noshowappointments" target="_blank" rel="noreferrer">
                  kaggle.com/datasets/joniarroba/noshowappointments
                </a>
                ), or your own clinic’s export. Processed entirely in your browser — the file never leaves this device.
              </p>
            </div>
            <label className="inline-flex h-10 cursor-pointer items-center border border-ink bg-ink px-4 text-sm text-paper hover:bg-ink/85">
              {busy ? 'Reading…' : '⬆ Upload CSV'}
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
          </div>
          {err && <div className="mt-3 text-sm text-c-red">{err}</div>}
          {s.noShow ? (
            <>
              <div className="mt-6 grid gap-px border border-ink bg-ink sm:grid-cols-3">
                <div className="bg-paper px-4 py-3">
                  <div className="font-pixel text-2xl">{s.noShow.rows.toLocaleString()}</div>
                  <div className="text-[11px] text-mute">appointments in {s.noShow.source}</div>
                </div>
                <div className="bg-paper px-4 py-3">
                  <div className="font-pixel text-2xl">{(s.noShow.rate * 100).toFixed(1)}%</div>
                  <div className="text-[11px] text-mute">overall no-show rate</div>
                </div>
                <div className="bg-paper px-4 py-3">
                  <div className="text-sm">
                    The simulator’s <a className="underline" href={href('how')}>random days</a> now use this real no-show rate.
                  </div>
                  <button className="mt-1 text-[11px] text-mute underline" onClick={() => update((st) => void (st.noShow = null))}>
                    Remove imported model
                  </button>
                </div>
              </div>
              <div className="mt-6 grid gap-6 lg:grid-cols-3">
                <RateChart title="No-show rate by booking lead time" rows={s.noShow.byLeadTime} />
                <RateChart title="By SMS reminder" rows={s.noShow.bySms} />
                <RateChart title="By age group" rows={s.noShow.byAge} />
              </div>
            </>
          ) : (
            <div className="mt-6 border border-dashed border-rule p-6 text-center text-sm text-mute">No history imported yet.</div>
          )}
        </Card>
      </section>
    </div>
  );
}

function RateChart({ title, rows }: { title: string; rows: RateRow[] }) {
  const data = rows.map((r) => ({ label: r.label, rate: Math.round(r.rate * 1000) / 10, n: r.n }));
  return (
    <div className="border border-rule p-4">
      <div className="text-sm font-semibold">{title}</div>
      <div className="mt-3 h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 16, right: 4, bottom: 0, left: -18 }}>
            <CartesianGrid stroke="#d6d5d0" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#6b6a66' }} stroke="#c8c7c2" interval={0} />
            <YAxis unit="%" tick={{ fontSize: 10, fill: '#6b6a66' }} stroke="#c8c7c2" />
            <Tooltip
              formatter={(v: number, _n, item) => [`${v}% of ${(item.payload as { n: number }).n.toLocaleString()} appointments`, 'No-show']}
              contentStyle={{ border: '1px solid #0e0e0e', borderRadius: 0, background: '#ecebe8', fontSize: 12 }}
            />
            <Bar dataKey="rate" fill={BAR} radius={[4, 4, 0, 0]} isAnimationActive={false} label={{ position: 'top', fontSize: 10, fill: '#0e0e0e' }} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
