import { ScanPlane } from '../components/ScanPlane';
import { Btn, Kicker } from '../live/kit';
import { startNewDay, useNow, useStore } from '../live/store';
import { href } from '../router';

const VIEWS = [
  {
    r: 'patient' as const,
    title: 'Patient app',
    who: 'For patients',
    body: 'Book a visit, get told exactly when to leave home, watch your place in line, and swap slots with someone if you’re flexible.',
  },
  {
    r: 'reception' as const,
    title: 'Reception desk',
    who: 'For front-desk staff',
    body: 'Today’s list at a glance. Check people in, add walk-ins and emergencies, mark no-shows — the schedule repairs itself.',
  },
  {
    r: 'doctor' as const,
    title: 'Doctor console',
    who: 'For doctors',
    body: 'One button: call next. See who’s waiting and for how long, and tell everyone at once if you’re running late.',
  },
  {
    r: 'display' as const,
    title: 'Waiting-room TV',
    who: 'For the waiting area',
    body: 'Now serving, up next and room numbers on a big screen — no more crowding the doctor’s door.',
  },
];

export function Home() {
  const s = useStore();
  const now = useNow();
  const live = s.live;
  const waiting = live.patients.filter((p) => p.status === 'WAITING').length;
  const home = live.patients.filter((p) => p.status === 'BOOKED' || p.status === 'EN_ROUTE').length;
  const seen = live.patients.filter((p) => p.calledAt !== null && p.checkedInAt !== null);
  const avgWait = seen.length ? Math.round(seen.reduce((a, p) => a + (p.calledAt! - p.checkedInAt!), 0) / seen.length) : null;

  const tryDemo = () => {
    startNewDay({ sample: true, demoClock: true });
    location.hash = href('reception');
  };

  return (
    <>
      <section className="mx-auto grid max-w-[1400px] items-center gap-6 px-4 pb-12 pt-12 sm:px-8 lg:grid-cols-[1.05fr_1fr]">
        <div>
          <h1 className="font-pixel text-[60px] font-bold uppercase leading-[0.9] tracking-tight sm:text-[104px] xl:text-[124px]">Tarmac</h1>
          <div className="mt-3 font-pixel text-xl uppercase leading-tight sm:text-3xl">
            Wait at home,
            <br />
            not in the corridor
          </div>
          <p className="mt-8 max-w-[480px] text-[15px] leading-relaxed">
            Smart queue and appointment management for outpatient clinics. TARMAC predicts when each patient will actually be seen and tells
            them when to leave home — so the waiting room stays empty and the doctor stays busy.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Btn variant="primary" size="lg" onClick={tryDemo}>
              ▶ Try a live demo day
            </Btn>
            <a href={href('patient')} className="text-sm hover:underline">
              Book as a patient&nbsp;&nbsp;›
            </a>
          </div>
        </div>
        <ScanPlane />
      </section>

      <section className="border-t border-ink">
        <div className="mx-auto grid max-w-[1400px] grid-cols-2 divide-x divide-rule px-4 sm:px-8 md:grid-cols-4">
          {[
            [String(live.patients.length), 'patients booked today'],
            [String(home), 'waiting comfortably at home'],
            [String(waiting), 'in the waiting room now'],
            [avgWait !== null ? `${avgWait} min` : '—', 'average wait in clinic today'],
          ].map(([n, l], i) => (
            <div key={l} className={`py-6 ${i ? 'pl-5' : ''}`}>
              <div className="font-pixel text-3xl">{n}</div>
              <div className="mt-1 text-xs text-mute">{l}</div>
            </div>
          ))}
        </div>
        <div className="mx-auto max-w-[1400px] px-4 pb-3 text-[11px] text-mute sm:px-8">
          Live from this clinic · {live.date} · clinic clock {String(Math.floor(now / 60)).padStart(2, '0')}:{String(now % 60).padStart(2, '0')}
        </div>
      </section>

      <section className="border-t border-ink">
        <div className="mx-auto max-w-[1400px] px-4 py-12 sm:px-8">
          <Kicker>One system, four screens</Kicker>
          <h2 className="mt-2 font-pixel text-3xl uppercase sm:text-4xl">Pick your view</h2>
          <div className="mt-8 grid gap-px border border-ink bg-ink sm:grid-cols-2 xl:grid-cols-4">
            {VIEWS.map((v) => (
              <a key={v.r} href={href(v.r)} className="group flex flex-col bg-paper p-6 hover:bg-paper-2">
                <Kicker>{v.who}</Kicker>
                <div className="mt-3 text-xl font-semibold">{v.title}</div>
                <p className="mt-2 flex-1 text-[13px] leading-relaxed text-ink/80">{v.body}</p>
                <span className="mt-5 text-sm group-hover:underline">Open ›</span>
              </a>
            ))}
          </div>
          <p className="mt-4 text-xs text-mute">
            Tip: open several views in separate windows — they stay in sync instantly, like separate devices.
          </p>
        </div>
      </section>

      <section className="border-t border-ink bg-ink text-paper">
        <div className="mx-auto grid max-w-[1400px] gap-8 px-4 py-12 sm:px-8 md:grid-cols-[1.2fr_1fr]">
          <div>
            <Kicker>
              <span className="text-paper/60">Why</span>
            </Kicker>
            <p className="mt-3 font-pixel text-2xl leading-snug sm:text-3xl">
              Patients at a government OPD spend 242.8 minutes waiting to be called — for a 12.8-minute consultation.
            </p>
            <p className="mt-3 text-[11px] text-paper/60">
              Kumari K., Int J Community Med Public Health 2026;13(11):6667–71 (patient-reported, n=255).
            </p>
          </div>
          <div className="flex flex-col justify-center gap-3 text-sm text-paper/85">
            <p>
              Air-traffic control solved this decades ago: a plane doesn’t take off until there’s a slot for it to land. TARMAC brings the same
              ideas to clinics — fair booking order, hold-at-home, instant gap filling, and patient-to-patient slot swaps.
            </p>
            <a href={href('how')} className="text-paper underline">
              See how it works, with the simulator and the numbers ›
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
