import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from 'recharts';
import { fmtTime, type Metrics, type RunResult } from '../../engine';
import type { SimApi } from '../useSimulation';

// Validated pair (dataviz validator: CVD ΔE 24.1, normal ΔE 32.9, contrast pass).
const BASE = '#d93a3c';
const TARM = '#3071d9';

function occupancy(run: { patients: RunResult['patients'] }, t: number) {
  let n = 0;
  for (const p of run.patients) {
    if (p.kind !== 'ROUTINE' || p.arrivedAt === null || p.arrivedAt > t) continue;
    if (p.consultStart === null || p.consultStart > t) n++;
  }
  return n;
}

function ChartTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  return (
    <div className="border border-ink bg-paper px-3 py-2 text-xs shadow-[3px_3px_0_#0e0e0e]">
      <div className="mb-1 font-pixel text-[11px]">{typeof label === 'number' ? fmtTime(label) : label}</div>
      {payload.map((p) => (
        <div key={p.dataKey as string} className="flex items-center gap-2">
          <span className="inline-block h-2 w-3" style={{ background: p.color }} />
          <span className="text-mute">{p.name}</span>
          <b className="ml-auto tabular-nums">{p.value}</b>
        </div>
      ))}
    </div>
  );
}

export function MetricsView({ api }: { api: SimApi }) {
  const { sim, baseline, comparison } = api;

  const series = useMemo(() => {
    const start = Math.min(...sim.day.doctors.map((d) => d.sessionStart)) - 60;
    const end = Math.max(baseline.endedAt, sim.finished ? sim.t : Math.max(...sim.day.doctors.map((d) => d.sessionEnd)) + 60);
    const out: { t: number; baseline: number; tarmac: number | null }[] = [];
    const live = { patients: [...sim.patients.values()] };
    for (let t = start; t <= end; t += 5) {
      out.push({ t, baseline: occupancy(baseline, t), tarmac: t <= sim.t ? occupancy(live, t) : null });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api.version, baseline]);

  const nowWaiting = [...sim.patients.values()].filter((p) => p.kind === 'ROUTINE' && p.status === 'WAITING').length;
  const baseWaiting = occupancy(baseline, sim.t);

  return (
    <div className="grid gap-8">
      {/* hero number */}
      <div className="grid gap-px border border-ink bg-ink md:grid-cols-[1.3fr_1fr_1fr]">
        <div className="bg-ink p-6 text-paper">
          <div className="font-pixel text-[11px] uppercase tracking-wider text-paper/60">Mean time in clinic</div>
          {comparison ? (
            <>
              <div className="mt-2 font-pixel text-6xl leading-none sm:text-7xl">−{comparison.meanTimeInClinicReductionPct}%</div>
              <div className="mt-3 max-w-md text-sm text-paper/80">{comparison.headline}</div>
            </>
          ) : (
            <>
              <div className="mt-2 font-pixel text-4xl leading-none">Day in progress</div>
              <div className="mt-3 max-w-md text-sm text-paper/70">
                The full TARMAC vs baseline comparison appears when the clinic day ends. Press ⏭ End to skip ahead.
              </div>
              <button onClick={api.runToEnd} className="mt-4 h-9 border border-paper px-3 font-pixel text-[11px] uppercase hover:bg-paper hover:text-ink">
                ⏭ Run to end of day
              </button>
            </>
          )}
        </div>
        <LiveTile label="In the waiting room right now" a={baseWaiting} b={nowWaiting} at={fmtTime(sim.t)} />
        <LiveTile
          label="Patient-hours spent in clinic"
          a={comparison ? comparison.baseline.patientHoursInClinic : null}
          b={comparison ? comparison.tarmac.patientHoursInClinic : null}
          at={comparison ? `${comparison.patientHoursReturned} h returned` : 'final at day end'}
        />
      </div>

      {/* occupancy over the day */}
      <div className="border border-ink p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="font-pixel text-sm uppercase">Waiting-room headcount through the day</div>
            <div className="text-xs text-mute">Same patients, same consult times, same no-shows and emergencies — only the scheduling policy differs.</div>
          </div>
        </div>
        <div className="mt-4 h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 10, right: 90, bottom: 0, left: -10 }}>
              <CartesianGrid stroke="#d6d5d0" vertical={false} />
              <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={fmtTime} tick={{ fontSize: 11, fill: '#6b6a66' }} stroke="#c8c7c2" tickCount={9} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6b6a66' }} stroke="#c8c7c2" />
              <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#0e0e0e', strokeDasharray: '3 3' }} />
              <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
              <Line
                type="stepAfter"
                dataKey="baseline"
                name="Today (everyone told 9:00)"
                stroke={BASE}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
              <Line type="stepAfter" dataKey="tarmac" name="TARMAC" stroke={TARM} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {comparison && <FinalComparison b={comparison.baseline} t={comparison.tarmac} />}
    </div>
  );
}

function LiveTile({ label, a, b, at }: { label: string; a: number | null; b: number | null; at: string }) {
  return (
    <div className="bg-paper p-6">
      <div className="font-pixel text-[11px] uppercase tracking-wider text-mute">{label}</div>
      <div className="mt-3 flex items-end gap-6">
        <div>
          <div className="font-pixel text-4xl leading-none">{a ?? '—'}</div>
          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-mute">
            <i className="inline-block h-2 w-3" style={{ background: BASE }} /> Today
          </div>
        </div>
        <div>
          <div className="font-pixel text-4xl leading-none">{b ?? '—'}</div>
          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-mute">
            <i className="inline-block h-2 w-3" style={{ background: TARM }} /> TARMAC
          </div>
        </div>
      </div>
      <div className="mt-3 text-[11px] text-mute">{at}</div>
    </div>
  );
}

function FinalComparison({ b, t }: { b: Metrics; t: Metrics }) {
  const bars = [
    { k: 'Mean', baseline: b.meanTimeInClinic, tarmac: t.meanTimeInClinic },
    { k: 'Median', baseline: b.medianTimeInClinic, tarmac: t.medianTimeInClinic },
    { k: 'p90', baseline: b.p90TimeInClinic, tarmac: t.p90TimeInClinic },
    { k: 'Worst', baseline: b.maxTimeInClinic, tarmac: t.maxTimeInClinic },
  ];
  const rows: [string, keyof Metrics, 'lower' | 'higher' | 'info'][] = [
    ['Routine patients seen', 'routinePatientsSeen', 'info'],
    ['Mean time in clinic (min)', 'meanTimeInClinic', 'lower'],
    ['Median time in clinic (min)', 'medianTimeInClinic', 'lower'],
    ['p90 time in clinic (min)', 'p90TimeInClinic', 'lower'],
    ['Patient-hours in clinic', 'patientHoursInClinic', 'lower'],
    ['Doctor idle (min, all doctors)', 'doctorIdleMinutes', 'lower'],
    ['Doctor overtime (min, all doctors)', 'doctorOvertimeMinutes', 'lower'],
    ['Capacity wasted by no-shows (min)', 'capacityWastedByNoShowsMinutes', 'lower'],
    ['Slots vacated', 'slotsVacated', 'info'],
    ['Slots recovered by compression', 'slotsRecoveredByCompression', 'higher'],
    ['Swaps executed', 'swapsExecuted', 'info'],
    ['Advisories sent', 'advisoriesSent', 'info'],
    ['Emergencies seen', 'emergenciesSeen', 'info'],
  ];
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_1.1fr]">
      <div className="border border-ink p-5">
        <div className="font-pixel text-sm uppercase">Minutes sitting in the clinic</div>
        <div className="text-xs text-mute">Arrival → called in, routine patients</div>
        <div className="mt-4 h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={bars} barGap={2} barCategoryGap="28%" margin={{ top: 18, right: 8, bottom: 0, left: -10 }}>
              <CartesianGrid stroke="#d6d5d0" vertical={false} />
              <XAxis dataKey="k" tick={{ fontSize: 11, fill: '#6b6a66' }} stroke="#c8c7c2" />
              <YAxis tick={{ fontSize: 11, fill: '#6b6a66' }} stroke="#c8c7c2" />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(14,14,14,0.06)' }} />
              <Legend iconType="square" wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="baseline" name="Today" fill={BASE} radius={[4, 4, 0, 0]} isAnimationActive={false} label={{ position: 'top', fontSize: 11, fill: '#0e0e0e' }} />
              <Bar dataKey="tarmac" name="TARMAC" fill={TARM} radius={[4, 4, 0, 0]} isAnimationActive={false} label={{ position: 'top', fontSize: 11, fill: '#0e0e0e' }} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="border border-ink">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ink text-left font-pixel text-[11px] uppercase">
              <th className="px-4 py-2.5">Metric</th>
              <th className="px-4 py-2.5 text-right">Today</th>
              <th className="px-4 py-2.5 text-right">TARMAC</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, key, dir]) => {
              const bv = b[key] as number;
              const tv = t[key] as number;
              const better = dir === 'info' || bv === tv ? null : dir === 'lower' ? tv < bv : tv > bv;
              return (
                <tr key={key} className="border-b border-rule last:border-0">
                  <td className="px-4 py-2">{label}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{bv}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    <span className={better === null ? '' : better ? 'font-semibold' : 'text-c-red'}>
                      {tv}
                      {better !== null && <span className="ml-1 text-[10px]">{better ? '▼' : '▲'}</span>}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="border-t border-ink bg-paper-2 px-4 py-3 text-[11px] leading-relaxed text-mute">
          Honest trade-off: holding patients at home means the doctor occasionally waits for a patient to walk in, so doctor idle
          time can rise. Patients are advised at the p10 of their predicted start to keep that small; the advisory percentile is configurable.
        </div>
      </div>
    </div>
  );
}
