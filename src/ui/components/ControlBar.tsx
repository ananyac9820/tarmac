import { useEffect, useMemo, useState } from 'react';
import { fmtTime } from '../../engine';
import { SPEEDS, type Mode, type SimApi } from '../useSimulation';
import { EVENT_STYLE, HEADLINE_EVENTS } from '../visual';

const btn =
  'h-9 border border-ink px-3 font-pixel text-[11px] uppercase tracking-wider transition-colors hover:bg-ink hover:text-paper disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink';

export function ControlBar({ api, onRunDemo }: { api: SimApi; onRunDemo: () => void }) {
  const { sim, setup, playing, setPlaying, speed, setSpeed, reset, step, runToEnd } = api;
  const [seedText, setSeedText] = useState(String(setup.seed));
  useEffect(() => setSeedText(String(setup.seed)), [setup]);

  const open = sim.startedAt;
  const close = Math.max(...sim.day.doctors.map((d) => d.sessionEnd)) + 60;
  const progress = Math.min(1, (sim.t - open) / (close - open));

  const switchMode = (m: Mode) => reset(m, m === 'DEMO' ? 42 : Number(seedText) || 42);

  return (
    <div className="z-40 border-b border-ink bg-paper/95 backdrop-blur md:sticky md:top-0">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 sm:px-8">
        {/* scenario */}
        <div className="flex border border-ink">
          {(['DEMO', 'RANDOM'] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => switchMode(m)}
              className={`h-9 px-3 font-pixel text-[11px] uppercase tracking-wider ${setup.mode === m ? 'bg-ink text-paper' : 'hover:bg-paper-2'}`}
            >
              {m === 'DEMO' ? 'Scripted demo' : 'Random day'}
            </button>
          ))}
        </div>
        <label className={`flex items-center gap-2 text-xs ${setup.mode === 'DEMO' ? 'opacity-40' : ''}`}>
          <span className="font-pixel text-[10px] uppercase tracking-wider text-mute">Seed</span>
          <input
            type="number"
            value={seedText}
            disabled={setup.mode === 'DEMO'}
            onChange={(e) => setSeedText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && reset('RANDOM', Number(seedText) || 0)}
            className="h-9 w-20 border border-ink bg-transparent px-2 text-sm"
          />
          {setup.mode === 'RANDOM' && (
            <button className={btn} onClick={() => reset('RANDOM', Number(seedText) || 0)}>
              Load
            </button>
          )}
        </label>

        {/* clock */}
        <div className="order-first flex min-w-[150px] flex-1 items-center gap-3 sm:order-none sm:flex-none">
          <div className="font-pixel text-3xl leading-none tabular-nums">{fmtTime(sim.t)}</div>
          <div className="hidden w-28 flex-col gap-1 sm:flex">
            <div className="h-1.5 w-full bg-paper-2">
              <div className="h-full bg-ink" style={{ width: `${progress * 100}%` }} />
            </div>
            <div className="text-[10px] uppercase tracking-wider text-mute">
              {sim.finished ? 'day complete' : playing ? 'live' : 'paused'} · {setup.day.date}
            </div>
          </div>
        </div>

        {/* transport */}
        <div className="flex items-center gap-1.5">
          <button className={btn} onClick={() => reset(setup.mode, setup.seed)} title="Reset">
            ⏮
          </button>
          <button
            className={`${btn} min-w-[86px] bg-ink text-paper hover:bg-paper hover:text-ink`}
            disabled={sim.finished}
            onClick={() => setPlaying(!playing)}
          >
            {playing ? '❚❚ Pause' : '▶ Play'}
          </button>
          <button className={btn} disabled={sim.finished || playing} onClick={() => step(1)} title="Step one minute">
            +1m
          </button>
          <button className={btn} disabled={sim.finished || playing} onClick={() => step(15)} title="Step 15 minutes">
            +15m
          </button>
          <button className={btn} disabled={sim.finished} onClick={runToEnd} title="Run to end of day">
            ⏭ End
          </button>
        </div>

        <div className="flex items-center gap-1">
          <span className="mr-1 font-pixel text-[10px] uppercase tracking-wider text-mute">Speed</span>
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              className={`h-7 min-w-8 border px-1.5 text-[11px] ${speed === s ? 'border-ink bg-ink text-paper' : 'border-rule hover:border-ink'}`}
              title={`${s} simulated minutes per second`}
            >
              {s}×
            </button>
          ))}
        </div>

        <button onClick={onRunDemo} className={`${btn} ml-auto hidden bg-ink text-paper hover:bg-paper hover:text-ink lg:block`}>
          ▶ Replay demo
        </button>
      </div>
      <Caption api={api} />
    </div>
  );
}

/** Headline ticker: the most recent noteworthy event, explained. */
function Caption({ api }: { api: SimApi }) {
  const { sim } = api;
  const latest = useMemo(() => {
    for (let i = sim.events.length - 1; i >= 0; i--) {
      const e = sim.events[i];
      if (HEADLINE_EVENTS.includes(e.type)) return e;
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api.version]);
  const counters = sim.counters;
  const style = latest ? EVENT_STYLE[latest.type] : undefined;
  return (
    <div className="border-t border-rule bg-paper-2/60">
      <div className="mx-auto flex max-w-[1400px] items-center gap-3 overflow-hidden px-4 py-1.5 text-xs sm:px-8">
        {latest ? (
          <div key={latest.seq} className="caption-in flex min-w-0 flex-1 items-center gap-2">
            <span className="shrink-0 font-pixel text-[10px] text-mute">{fmtTime(latest.t)}</span>
            <span className="shrink-0 px-1.5 py-0.5 font-pixel text-[10px] text-white" style={{ background: style?.color ?? '#111' }}>
              {style?.tag ?? latest.type}
            </span>
            <span className="truncate">{latest.message}</span>
          </div>
        ) : (
          <div className="flex-1 truncate text-mute">Slots assigned by Ration-By-Schedule. Press ▶ Play to open the clinic.</div>
        )}
        <div className="hidden shrink-0 gap-4 text-[11px] text-mute md:flex">
          <span>advisories <b className="text-ink">{counters.advisoriesSent}</b></span>
          <span>compressed <b className="text-ink">{counters.slotsRecovered}</b></span>
          <span>swaps <b className="text-ink">{counters.swaps}</b></span>
        </div>
      </div>
    </div>
  );
}
