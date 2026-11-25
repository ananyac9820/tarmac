import { fmtTime, isPending, slotStartOf } from '../../engine';
import { Logo } from '../Shell';
import { useNow, useStore } from '../live/store';
import { href } from '../router';

/** Full-screen waiting-room TV. Big type, high contrast, no interaction needed. */
export function Display() {
  const s = useStore();
  const now = useNow();
  const live = s.live;
  const latest = [...live.events].reverse().find((e) => e.type === 'CONSULT_STARTED');

  return (
    <div className="flex min-h-screen flex-col bg-ink text-paper">
      <header className="flex items-center justify-between border-b border-paper/20 px-6 py-4 sm:px-10">
        <a href={href('home')} className="flex items-center gap-3 text-paper">
          <Logo className="h-8 w-8" />
          <span className="font-pixel text-lg tracking-widest">{live.clinicName}</span>
        </a>
        <div className="font-pixel text-4xl tabular-nums sm:text-5xl">{fmtTime(now)}</div>
      </header>

      <div className="grid flex-1 gap-px bg-paper/20 md:grid-cols-3">
        {live.doctors.map((d) => {
          const cur = d.currentId ? live.patients.find((p) => p.id === d.currentId) : null;
          const up = live.patients
            .filter((p) => p.doctorId === d.id && p.status === 'WAITING')
            .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'EMERGENCY' ? -1 : 1) || (slotStartOf(live, a) ?? 0) - (slotStartOf(live, b) ?? 0))
            .slice(0, 4);
          const onTheWay = live.patients.filter((p) => p.doctorId === d.id && (p.status === 'EN_ROUTE' || p.status === 'BOOKED') && isPending(p)).length;
          const flash = latest && cur && latest.patientId === cur.id && now - latest.t < 2;
          return (
            <section key={d.id} className="flex flex-col bg-ink p-6 sm:p-8">
              <div className="text-sm uppercase tracking-wider text-paper/60">{d.specialty}</div>
              <div className="text-xl font-semibold">{d.name}</div>
              <div className="mt-1 inline-block w-fit bg-paper px-2 py-0.5 font-pixel text-sm text-ink">{d.room}</div>

              <div className="mt-8 text-sm uppercase tracking-wider text-paper/60">Now serving</div>
              <div className={`font-pixel text-[120px] leading-none tabular-nums sm:text-[150px] ${flash ? 'blink' : ''}`} style={{ color: cur ? '#5fd16e' : '#555' }}>
                {cur ? String(cur.token).padStart(2, '0') : '--'}
              </div>
              {!d.present && <div className="mt-2 text-lg text-c-orange">Doctor arriving{d.delayMinutes ? ` · ${d.delayMinutes} min late` : ''}</div>}

              <div className="mt-8 text-sm uppercase tracking-wider text-paper/60">Up next</div>
              <div className="mt-2 flex flex-wrap gap-3">
                {up.length === 0 && <span className="text-lg text-paper/50">—</span>}
                {up.map((p) => (
                  <span key={p.id} className="border border-paper/40 px-3 py-1 font-pixel text-3xl tabular-nums" style={p.kind === 'EMERGENCY' ? { borderColor: '#e35b92', color: '#e35b92' } : undefined}>
                    {String(p.token).padStart(2, '0')}
                  </span>
                ))}
              </div>
              <div className="mt-auto pt-8 text-sm text-paper/60">{onTheWay} more patients waiting comfortably at home</div>
            </section>
          );
        })}
      </div>

      <footer className="border-t border-paper/20 px-6 py-3 text-center text-sm text-paper/70 sm:px-10">
        Please wait for your token. Booked patients: your phone will tell you when to come — no need to arrive early.
      </footer>
    </div>
  );
}
