import {
  callNext,
  doctorDelay,
  finishCurrent,
  fmtTime,
  isPending,
  liveModel,
  nextFor,
  setDoctorPresent,
  slotStartOf,
  type LivePatient,
} from '../../engine';
import { Btn, Card, Empty, Kicker, StatusBadge } from '../live/kit';
import { dispatch, useNow, useStore } from '../live/store';
import { href } from '../router';

export function DoctorConsole({ param }: { param: string | null }) {
  const s = useStore();
  const now = useNow();
  const live = s.live;
  const d = live.doctors.find((x) => x.id === param) ?? live.doctors[0];
  if (!d) return <Empty>No doctors configured.</Empty>;

  const cur = d.currentId ? live.patients.find((p) => p.id === d.currentId)! : null;
  const decision = nextFor(live, d.id, now);
  const onBreak = d.breakUntil !== null && d.breakUntil > now;
  const model = liveModel(d, live.config.priorWeight);
  const mine = live.patients.filter((p) => p.doctorId === d.id);
  const queue = mine
    .filter((p) => isPending(p))
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'EMERGENCY' ? -1 : 1) || (a.slotIndex ?? 0) - (b.slotIndex ?? 0));
  const done = mine.filter((p) => p.status === 'DONE' && p.kind === 'ROUTINE');
  const avgWait = done.length ? Math.round(done.reduce((a, p) => a + (p.calledAt! - p.checkedInAt!), 0) / done.length) : null;
  const waitingCount = mine.filter((p) => p.status === 'WAITING').length;

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-8">
      <div className="flex flex-wrap gap-1.5">
        {live.doctors.map((x) => (
          <a key={x.id} href={href('doctor', x.id)} className={`border px-3 py-1.5 text-sm ${x.id === d.id ? 'border-ink bg-ink text-paper' : 'border-rule hover:border-ink'}`}>
            {x.name}
          </a>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Kicker>
            Doctor console · {d.specialty} · {d.room}
          </Kicker>
          <h1 className="mt-1 font-pixel text-3xl uppercase sm:text-4xl">{d.name}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {!d.present ? (
            <Btn variant="primary" onClick={() => dispatch((l, t) => setDoctorPresent(l, d.id, true, t))}>
              I’m in — start session
            </Btn>
          ) : (
            <Btn onClick={() => dispatch((l, t) => doctorDelay(l, d.id, 15, t))}>{onBreak ? `On break until ${fmtTime(d.breakUntil!)} · +15` : 'Take a 15-min break'}</Btn>
          )}
          {!d.present && (
            <Btn variant="quiet" onClick={() => dispatch((l, t) => doctorDelay(l, d.id, 15, t))}>
              I’ll be 15 min late
            </Btn>
          )}
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-6">
          {/* current */}
          <Card className="p-6">
            <Kicker>With you now</Kicker>
            {cur ? (
              <>
                <div className="mt-3 flex items-baseline gap-4">
                  <span className="font-pixel text-6xl leading-none">{String(cur.token).padStart(2, '0')}</span>
                  <div>
                    <div className="text-xl font-semibold">{cur.name}</div>
                    <div className="text-sm text-mute">
                      {cur.kind === 'EMERGENCY' ? 'Emergency · ' : ''}in for {now - (d.currentStartedAt ?? now)} min · waited {(cur.calledAt ?? 0) - (cur.checkedInAt ?? 0)} min
                    </div>
                  </div>
                </div>
                <div className="mt-6 flex flex-wrap gap-2">
                  <Btn
                    variant="primary"
                    size="lg"
                    onClick={() =>
                      dispatch((l, t) => {
                        finishCurrent(l, d.id, t);
                        callNext(l, d.id, t);
                      })
                    }
                  >
                    Finish & call next
                  </Btn>
                  <Btn size="lg" onClick={() => dispatch((l, t) => finishCurrent(l, d.id, t))}>
                    Finish
                  </Btn>
                </div>
              </>
            ) : (
              <div className="mt-3">
                <div className="text-lg">No one with you.</div>
                {decision.next ? (
                  <Btn variant="primary" size="lg" className="mt-4" onClick={() => dispatch((l, t) => void callNext(l, d.id, t))}>
                    Call token {decision.next.token} — {decision.next.name}
                    {decision.next.kind === 'EMERGENCY' ? ' (emergency)' : ''}
                  </Btn>
                ) : decision.waitingFor ? (
                  <WaitingFor p={decision.waitingFor} now={now} doctorId={d.id} queue={queue} />
                ) : (
                  <div className="mt-2 text-sm text-mute">
                    {waitingCount ? '' : 'Nobody is in the waiting room yet. Patients are being told when to leave home.'}
                  </div>
                )}
              </div>
            )}
          </Card>

          {/* stats */}
          <div className="grid grid-cols-2 gap-px border border-ink bg-ink sm:grid-cols-4">
            {[
              ['Seen today', String(done.length)],
              ['In waiting room', String(waitingCount)],
              ['Avg wait in clinic', avgWait !== null ? `${avgWait}m` : '—'],
              ['Your typical consult', `${model.median().toFixed(0)}m`],
            ].map(([l, v]) => (
              <div key={l} className="bg-paper px-4 py-3">
                <div className="font-pixel text-2xl">{v}</div>
                <div className="text-xs text-mute">{l}</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-mute">
            {d.observed.length
              ? `Leave-home times for your patients are planned on ${d.observed.length} of your real consultations today (median ${model.median().toFixed(1)} min, 90% under ${model.percentile(0.9).toFixed(1)} min), blended with your history.`
              : `Planning uses your historical consult times (median ${model.median().toFixed(1)} min). It re-calibrates from today’s real consultations as you finish them.`}
          </p>
        </div>

        {/* queue */}
        <Card>
          <div className="border-b border-ink px-4 py-3">
            <Kicker>Your queue · {queue.length} to see</Kicker>
          </div>
          <div className="max-h-[560px] overflow-y-auto thin-scroll">
            {queue.length === 0 && <div className="p-4 text-sm text-mute">Queue is empty.</div>}
            {queue.map((p) => {
              const slot = slotStartOf(live, p);
              return (
                <div key={p.id} className="flex items-center gap-3 border-b border-rule px-4 py-2.5 last:border-0">
                  <span className="w-8 font-pixel tabular-nums">{String(p.token).padStart(2, '0')}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{p.name}</div>
                    <div className="text-[11px] text-mute">
                      {p.kind === 'EMERGENCY' ? 'Emergency' : `Slot ${slot !== null ? fmtTime(slot) : '—'}`}
                      {p.status === 'WAITING' && ` · waiting ${now - (p.checkedInAt ?? now)} min`}
                      {p.status === 'EN_ROUTE' && ` · ETA ${fmtTime(p.eta!)}`}
                    </div>
                  </div>
                  <StatusBadge p={p} />
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}

function WaitingFor({ p, now, doctorId, queue }: { p: LivePatient; now: number; doctorId: string; queue: LivePatient[] }) {
  const present = queue.filter((q) => q.status === 'WAITING');
  const eta = p.status === 'EN_ROUTE' && p.eta !== null ? p.eta : now + p.travelMinutes;
  return (
    <div className="mt-4 border border-dashed border-ink p-4 text-sm">
      Token <b>{p.token}</b> ({p.name}) has the next slot and is on the way — about {Math.max(0, eta - now)} min out.
      {present.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-mute">Or see someone who’s already here:</span>
          {present.slice(0, 3).map((q) => (
            <Btn key={q.id} size="sm" onClick={() => dispatch((l, t) => void callNext(l, doctorId, t, q.id))}>
              Call token {q.token}
            </Btn>
          ))}
        </div>
      )}
    </div>
  );
}
