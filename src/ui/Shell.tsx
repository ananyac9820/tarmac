import { useEffect, useState, type ReactNode } from 'react';
import { fmtTime } from '../engine';
import { Btn, Kicker } from './live/kit';
import { clockNow, startNewDay, update, useNow, useStore } from './live/store';
import { href, type Route } from './router';

export function Logo({ className = 'h-7 w-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 8 8" className={className} aria-label="TARMAC" fill="currentColor">
      <path d="M0 0h3v3H0zM5 0h3v3H5zM3 3h2v2H3zM0 5h3v3H0zM5 5h3v3H5z" />
    </svg>
  );
}

const NAV: [Route, string][] = [
  ['patient', 'Patient app'],
  ['reception', 'Reception'],
  ['doctor', 'Doctor'],
  ['display', 'Waiting-room TV'],
  ['data', 'Data'],
  ['how', 'How it works'],
];

export function Shell({ route, children }: { route: Route; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const store = useStore();
  const now = useNow();
  useEffect(() => {
    setOpen(false);
    setMenu(false);
  }, [route]);
  const c = store.clock;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-50 h-14 border-b border-ink bg-paper/95 backdrop-blur">
        <div className="mx-auto flex h-full max-w-[1400px] items-center gap-4 px-4 sm:px-8">
          <a href={href('home')} className="flex items-center gap-2.5">
            <Logo />
            <span className="font-pixel text-sm tracking-widest">TARMAC</span>
          </a>
          <nav className="ml-6 hidden gap-1 whitespace-nowrap xl:flex">
            {NAV.map(([r, label]) => (
              <a
                key={r}
                href={href(r)}
                className={`px-3 py-1.5 text-sm ${route === r ? 'bg-ink text-paper' : 'hover:bg-paper-2'}`}
              >
                {label}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {route !== 'how' && (
              <button
                onClick={() => setOpen((x) => !x)}
                className="flex h-9 items-center gap-2 border border-ink px-3 text-xs hover:bg-paper-2"
                title="Clinic clock & setup"
              >
                <span className={`inline-block h-2 w-2 ${c.mode === 'REAL' ? 'bg-c-green' : c.paused ? 'bg-mute' : 'bg-c-orange'}`} />
                <span className="font-pixel text-sm tabular-nums">{fmtTime(now)}</span>
                <span className="hidden text-mute sm:inline">{c.mode === 'REAL' ? 'live' : c.paused ? 'demo · paused' : `demo · ${c.speed * 60}×`}</span>
                <span className="text-mute">⚙</span>
              </button>
            )}
            <button className="h-9 border border-ink px-3 text-sm xl:hidden" onClick={() => setMenu((x) => !x)} aria-label="Menu">
              ☰
            </button>
          </div>
        </div>
        {menu && (
          <nav className="border-b border-ink bg-paper xl:hidden">
            {NAV.map(([r, label]) => (
              <a key={r} href={href(r)} onClick={() => setMenu(false)} className={`block border-t border-rule px-4 py-3 text-sm ${route === r ? 'bg-ink text-paper' : ''}`}>
                {label}
              </a>
            ))}
          </nav>
        )}
      </header>
      {open && route !== 'how' && <SetupPanel onClose={() => setOpen(false)} />}
      <main>{children}</main>
      <footer className="border-t border-ink">
        <div className="mx-auto flex max-w-[1400px] flex-wrap justify-between gap-2 px-4 py-6 text-[11px] text-mute sm:px-8">
          <span>TARMAC · clinic traffic control · HackKumbh 2026</span>
          <span>Runs entirely in your browser — no server, works offline.</span>
        </div>
      </footer>
    </div>
  );
}

function SetupPanel({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const c = s.clock;
  const setClock = (patch: Partial<typeof c>) =>
    update((st) => {
      const now = clockNow(st.clock);
      st.clock = { ...st.clock, baseMinute: now, baseMs: Date.now(), ...patch };
    });
  const openAll = () => {
    (['patient', 'reception', 'doctor', 'display'] as Route[]).forEach((r, i) =>
      window.open(`${location.pathname}${href(r)}`, `tarmac-${r}`, `width=720,height=860,left=${i * 60},top=${i * 40}`),
    );
  };
  return (
    <div className="border-b border-ink bg-paper-2">
      <div className="mx-auto grid max-w-[1400px] gap-6 px-4 py-6 sm:px-8 md:grid-cols-3">
        <div>
          <Kicker>Clinic day</Kicker>
          <div className="mt-1 text-sm">
            {s.live.clinicName} · {s.live.date} · {s.live.patients.length} patients
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Btn size="sm" variant="primary" onClick={() => startNewDay({ sample: true, demoClock: true })}>
              ▶ Demo day (sample patients, fast clock)
            </Btn>
            <Btn size="sm" onClick={() => confirm('Start an empty day on the real clock? Current data will be cleared — export it first from Data.') && startNewDay({ sample: false, demoClock: false })}>
              Empty day, real clock
            </Btn>
          </div>
          <p className="mt-2 text-[11px] text-mute">Real use: start an empty day; reception and patients book for real. Every timestamp is saved for export.</p>
        </div>
        <div>
          <Kicker>Clock</Kicker>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Btn size="sm" variant={c.mode === 'REAL' ? 'primary' : 'quiet'} onClick={() => setClock({ mode: 'REAL', paused: false })}>
              Real time
            </Btn>
            {[1, 2, 5].map((sp) => (
              <Btn key={sp} size="sm" variant={c.mode === 'DEMO' && c.speed === sp ? 'primary' : 'quiet'} onClick={() => setClock({ mode: 'DEMO', speed: sp, paused: false })}>
                Demo {sp * 60}×
              </Btn>
            ))}
            {c.mode === 'DEMO' && (
              <Btn size="sm" onClick={() => setClock({ paused: !c.paused })}>
                {c.paused ? '▶ Resume' : '❚❚ Pause'}
              </Btn>
            )}
          </div>
          <p className="mt-2 text-[11px] text-mute">Demo clock runs a clinic day in minutes so you can watch advisories, swaps and compression happen.</p>
        </div>
        <div>
          <Kicker>Autopilot (for demos)</Kicker>
          <div className="mt-2 flex flex-col gap-2 text-sm">
            {(['patients', 'doctors', 'desk'] as const).map((k) => (
              <label key={k} className="flex items-center gap-2">
                <input type="checkbox" checked={s.autopilot[k]} onChange={(e) => update((st) => void (st.autopilot[k] = e.target.checked))} />
                Simulate {k === 'patients' ? 'patients (leave home, arrive, check in)' : k === 'doctors' ? 'doctors (call next, finish)' : 'reception (mark silent patients no-show)'}
              </label>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <Btn size="sm" onClick={openAll}>
              Open all 4 views in windows
            </Btn>
            <Btn size="sm" variant="quiet" onClick={onClose}>
              Close
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}
