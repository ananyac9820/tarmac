import { useEffect, useState, type ReactNode } from 'react';
import { ControlBar } from './components/ControlBar';
import { EventLog } from './components/EventLog';
import { MetricsView } from './components/MetricsView';
import { PatientView } from './components/PatientView';
import { ScanPlane } from './components/ScanPlane';
import { Tower } from './components/Tower';
import { useSimulation } from './useSimulation';

function Logo() {
  return (
    <svg viewBox="0 0 8 8" className="h-7 w-7" aria-label="TARMAC">
      <path d="M0 0h3v3H0zM5 0h3v3H5zM3 3h2v2H3zM0 5h3v3H0zM5 5h3v3H5z" />
    </svg>
  );
}

function Section({ id, n, title, kicker, children }: { id: string; n: string; title: string; kicker: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-28 border-t border-ink">
      <div className="mx-auto max-w-[1400px] px-4 py-12 sm:px-8">
        <div className="mb-7 flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-pixel text-3xl uppercase leading-none sm:text-4xl">
            <span className="mr-3 text-mute">{n}</span>
            {title}
          </h2>
          <p className="max-w-xl text-sm text-mute">{kicker}</p>
        </div>
        {children}
      </div>
    </section>
  );
}

const MECHANISMS = [
  {
    atc: 'Ration-By-Schedule',
    clinic: 'Booking order is a property right',
    body: 'Slots are handed out in the order appointments were booked, at the doctor’s declared call rate. Nothing later in the pipeline can silently push anyone back.',
  },
  {
    atc: 'Ground holding',
    clinic: 'Wait at home, not in the corridor',
    body: 'A Monte Carlo over each doctor’s fitted consult-time distribution predicts when each patient will actually be called. They’re told to leave home at the p10 of that minus travel time — and re-advised when the day shifts.',
  },
  {
    atc: 'Compression',
    clinic: 'No-shows never waste the doctor',
    body: 'When a slot is vacated the queue is pulled up — but only by patients who can physically get there in time. Anyone who can’t keeps their place.',
  },
  {
    atc: 'CDM slot substitution',
    clinic: 'Patients trade slots with each other',
    body: 'A clinic-mediated exchange. A swap executes only if both patients are better off by their own stated preference. Non-participants are never touched.',
  },
  {
    atc: 'Priority handling + aging',
    clinic: 'Emergencies first, nobody starves',
    body: 'Emergencies preempt the queue, but every routine patient accrues priority while waiting, so even a stream of emergencies has a provable bound on how long anyone waits.',
  },
];

export function App() {
  const api = useSimulation();
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(
    () =>
      api.onFinish(() => {
        if (api.setup.mode === 'DEMO') document.getElementById('metrics')?.scrollIntoView({ behavior: 'smooth' });
      }),
    [api, api.onFinish, api.setup.mode],
  );

  // keep a sensible patient selected
  const first = [...api.sim.patients.values()][0]?.id ?? null;
  const current = selected && api.sim.patients.has(selected) ? selected : first;

  const runDemo = () => {
    api.reset('DEMO', 42);
    // Skip the silent pre-dawn (advisories are already planned) — still deterministic.
    api.stepTo(7 * 60 + 45);
    api.setSpeed(6);
    api.setPlaying(true);
    setTimeout(() => {
      const el = document.getElementById('tower');
      if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 100, behavior: 'smooth' });
    }, 50);
  };

  const pick = (id: string) => {
    setSelected(id);
    document.getElementById('patient')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen">
      {/* top nav */}
      <header className="mx-auto flex max-w-[1400px] items-center justify-between px-4 pt-6 sm:px-8">
        <a href="#top" className="flex items-center gap-3">
          <Logo />
          <span className="font-pixel text-sm tracking-widest">TARMAC</span>
        </a>
        <nav className="hidden gap-8 text-sm md:flex">
          <a href="#tower" className="hover:underline">Tower</a>
          <a href="#patient" className="hover:underline">Patient</a>
          <a href="#metrics" className="hover:underline">Metrics</a>
          <a href="#log" className="hover:underline">Event log</a>
          <a href="#how" className="hover:underline">How it works</a>
        </nav>
      </header>

      {/* hero */}
      <section id="top" className="mx-auto grid max-w-[1400px] items-center gap-6 px-4 pb-10 pt-10 sm:px-8 lg:grid-cols-[1.05fr_1fr]">
        <div>
          <h1 className="font-pixel text-[64px] font-bold uppercase leading-[0.9] tracking-tight sm:text-[104px] xl:text-[124px]">
            Tarmac
          </h1>
          <div className="mt-3 font-pixel text-xl uppercase leading-tight sm:text-3xl">
            Clinic traffic
            <br />
            control
          </div>
          <p className="mt-8 max-w-[460px] text-[15px] leading-relaxed">
            A clinic waiting room is an airborne holding stack. TARMAC borrows four mechanisms air-traffic control has used for decades
            and holds patients at home — not in the corridor.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-6">
            <button onClick={runDemo} className="h-11 bg-ink px-6 text-sm text-paper hover:bg-ink/85">
              ▶ Run scripted demo
            </button>
            <a href="#how" className="text-sm hover:underline">
              See how it works&nbsp;&nbsp;›
            </a>
          </div>
        </div>
        <ScanPlane />
      </section>

      {/* the problem in numbers */}
      <div className="border-t border-ink">
        <div className="mx-auto grid max-w-[1400px] grid-cols-1 divide-y divide-rule px-4 sm:grid-cols-3 sm:divide-x sm:divide-y-0 sm:px-8">
          {[
            ['260.4 min', 'mean patient journey, arrival to end of consultation'],
            ['242.8 min', 'of it spent waiting to be called'],
            ['12.8 min', 'with the doctor — under 5% of the visit'],
          ].map(([n, l]) => (
            <div key={n} className="py-6 sm:px-6 first:sm:pl-0">
              <div className="font-pixel text-3xl">{n}</div>
              <div className="mt-1 text-xs text-mute">{l}</div>
            </div>
          ))}
        </div>
        <div className="mx-auto max-w-[1400px] px-4 pb-4 text-[11px] text-mute sm:px-8">
          Outpatient time-motion data from an Indian government tertiary-care hospital.
        </div>
      </div>

      <ControlBar api={api} onRunDemo={runDemo} />

      <Section id="tower" n="01" title="Control tower" kicker="Each doctor’s queue is a ship deck. Every container is a booked slot, coloured by where that patient physically is right now.">
        <Tower api={api} selected={current} onSelect={pick} />
      </Section>

      <Section id="patient" n="02" title="Patient view" kicker="What the patient sees: when to leave home, where they stand, and the slot exchange. Pick anyone — or click a container above.">
        {current && <PatientView api={api} patientId={current} onSelect={setSelected} />}
      </Section>

      <Section id="metrics" n="03" title="Metrics" kicker="TARMAC against today’s “everyone come at 9, first come first served” — over the identical seeded patient stream.">
        <MetricsView api={api} />
      </Section>

      <Section id="log" n="04" title="Event log" kicker="Every advisory, compression and swap, with its reason. Click a row to open that patient.">
        <EventLog api={api} onSelect={pick} />
      </Section>

      <Section id="how" n="05" title="How it works" kicker="Five mechanisms, ported from air-traffic flow management to the outpatient clinic.">
        <div className="grid gap-px border border-ink bg-ink md:grid-cols-2 xl:grid-cols-5">
          {MECHANISMS.map((m, i) => (
            <div key={m.atc} className="flex flex-col bg-paper p-5">
              <div className="font-pixel text-[11px] uppercase text-mute">
                0{i + 1} · ATC: {m.atc}
              </div>
              <div className="mt-3 text-base font-semibold leading-snug">{m.clinic}</div>
              <p className="mt-2 text-[13px] leading-relaxed text-ink/80">{m.body}</p>
            </div>
          ))}
        </div>
        <div className="mt-6 grid gap-4 text-[13px] leading-relaxed text-ink/80 md:grid-cols-3">
          <p>
            <b className="text-ink">Deterministic.</b> Every random draw comes from one seeded generator. Same seed, byte-identical day — the demo
            replays exactly, at any playback speed.
          </p>
          <p>
            <b className="text-ink">Fair by construction.</b> Moving a patient later requires their consent (a swap) or an emergency, and is
            logged. The fairness invariants are asserted in the test suite.
          </p>
          <p>
            <b className="text-ink">Honest limits.</b> Synthetic patients and consult times, a single-clinic model, no EMR integration. Runs
            entirely in the browser — no server, no network.
          </p>
        </div>
      </Section>

      <footer className="border-t border-ink">
        <div className="mx-auto flex max-w-[1400px] flex-wrap justify-between gap-2 px-4 py-6 text-[11px] text-mute sm:px-8">
          <span>TARMAC · HackKumbh 2026 · Smart Queue &amp; Appointment Management</span>
          <span>Seed {api.setup.seed} · {api.setup.mode === 'DEMO' ? 'scripted demo' : 'random day'}</span>
        </div>
      </footer>
    </div>
  );
}
