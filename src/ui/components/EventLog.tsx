import { useMemo, useState } from 'react';
import { fmtTime, type EventType } from '../../engine';
import type { SimApi } from '../useSimulation';
import { EVENT_STYLE } from '../visual';

const FILTERS: { key: string; label: string; types: EventType[] | null }[] = [
  { key: 'key', label: 'Decisions', types: ['REVISED_ADVISORY', 'LEAVE_NOW', 'COMPRESSION', 'SWAP', 'EMERGENCY_ARRIVED', 'EMERGENCY_PREEMPT', 'NO_SHOW_DECLARED', 'CANCELLED', 'DOCTOR_DELAY_ANNOUNCED', 'CALL_RATE_CHANGED', 'LATE_ARRIVAL_BYPASS', 'GAP_FILL', 'EXCHANGE_OPT_IN', 'DAY_END'] },
  { key: 'adv', label: 'Advisories', types: ['ADVISORY', 'REVISED_ADVISORY', 'LEAVE_NOW'] },
  { key: 'comp', label: 'Compression', types: ['COMPRESSION', 'NO_SHOW_DECLARED', 'CANCELLED'] },
  { key: 'swap', label: 'Swaps', types: ['SWAP', 'EXCHANGE_OPT_IN'] },
  { key: 'emrg', label: 'Emergencies', types: ['EMERGENCY_ARRIVED', 'EMERGENCY_PREEMPT'] },
  { key: 'flow', label: 'Patient flow', types: ['DEPARTED', 'ARRIVED', 'CONSULT_STARTED', 'CONSULT_ENDED'] },
  { key: 'all', label: 'Everything', types: null },
];

export function EventLog({ api, onSelect }: { api: SimApi; onSelect: (id: string) => void }) {
  const [filter, setFilter] = useState('key');
  const [q, setQ] = useState('');
  const f = FILTERS.find((x) => x.key === filter)!;
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = api.sim.events.filter((e) => (!f.types || f.types.includes(e.type)) && (!needle || e.message.toLowerCase().includes(needle) || e.patientId?.toLowerCase() === needle));
    return out.slice(-500).reverse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api.version, filter, q]);

  return (
    <div className="border border-ink">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-ink p-3">
        {FILTERS.map((x) => (
          <button
            key={x.key}
            onClick={() => setFilter(x.key)}
            className={`h-8 border px-2.5 text-[11px] ${filter === x.key ? 'border-ink bg-ink text-paper' : 'border-rule hover:border-ink'}`}
          >
            {x.label}
          </button>
        ))}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="search name or id…"
          className="ml-auto h-8 w-full border border-rule bg-transparent px-2 text-xs sm:w-56"
        />
      </div>
      <div className="h-[420px] overflow-y-auto thin-scroll font-mono text-xs">
        {rows.length === 0 && <div className="p-4 text-mute">No events yet.</div>}
        {rows.map((e) => {
          const st = EVENT_STYLE[e.type];
          return (
            <div
              key={e.seq}
              onClick={() => e.patientId && onSelect(e.patientId)}
              className={`grid grid-cols-[46px_88px_1fr] items-baseline gap-2 border-b border-rule/60 px-3 py-1.5 ${e.patientId ? 'cursor-pointer hover:bg-paper-2' : ''}`}
            >
              <span className="text-mute tabular-nums">{fmtTime(e.t)}</span>
              <span className="truncate font-pixel text-[10px] text-white" style={{ background: st?.color ?? '#555', padding: '1px 5px', width: 'fit-content', maxWidth: '100%' }}>
                {st?.tag ?? e.type}
              </span>
              <span className="min-w-0 break-words">{e.message}</span>
            </div>
          );
        })}
      </div>
      <div className="border-t border-ink px-3 py-2 text-[11px] text-mute">
        {api.sim.events.length} events · every advisory, compression and swap is logged with its reason · showing latest {rows.length}
      </div>
    </div>
  );
}
