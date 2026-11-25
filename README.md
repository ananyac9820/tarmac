# TARMAC — Air-Traffic-Control scheduling for outpatient clinics

> HackKumbh 2026 (YCCE Nagpur) · Healthcare · Problem Statement 1: *Smart Queue & Appointment Management System*

**A clinic waiting room is an airborne holding stack.** Patients circle for hours, burning their day, while the
runway (the doctor) handles one at a time. Air traffic control solved this decades ago with *ground holding*:
don't let a plane take off until there is a slot for it to land. Clinics never borrowed the idea.

TARMAC ports four real air-traffic flow-management mechanisms into an outpatient clinic, plus a fifth to keep
emergencies fair. It is a fully client-side web app with a deterministic simulation engine, and it runs offline.

---

## The problem, in one number

A stage-wise OPD patient-flow study at a government tertiary teaching hospital in North India (255 OPD patients,
May–June 2026) reported:

| Measure | Minutes |
|---|---:|
| Mean total patient journey, arrival → consultation | **260.4** |
| Waiting from arrival to being called by the doctor (the primary bottleneck) | **242.8** |
| The consultation itself | **12.8** (under 5% of total time) |

Source: Kumari K. *Stage-wise analysis of outpatient department patient flow and waiting time at a government
tertiary teaching hospital in North India: a mixed-method study.* Int J Community Med Public Health.
2026;13(11):6667–6671. doi:[10.18203/2394-6040.ijcmph20264093](https://doi.org/10.18203/2394-6040.ijcmph20264093)

The study's arrival-to-consultation timings are patient-reported. The figures are quoted as reported in its abstract.

More than 95% of a patient's visit is spent waiting. That's the holding stack TARMAC is designed to shorten.

---

## The five mechanisms

| # | Air traffic control | In the clinic | Plain-language version |
|---|---|---|---|
| 1 | **Ration-By-Schedule (RBS)** | Fair baseline slots | Slots are handed out in the order appointments were *booked*, spaced at the doctor's declared call rate (patients/hour — the clinic's "airport arrival rate"). Booking order is a property right. |
| 2 | **Ground holding** | Wait at home, not in the corridor | For each doctor we fit a lognormal consultation-time model and run a Monte Carlo over the remaining queue, so uncertainty propagates (an overrunning consult is conditioned on how long it has *already* run). Each patient is told to leave home at `p10(predicted start) − travel time − buffer`, and gets a `REVISED_ADVISORY` if the day shifts by more than a threshold. |
| 3 | **Compression** | No-shows don't waste the doctor | When a slot is vacated (cancellation, or a no-show detected because LEAVE_NOW was never acknowledged), the queue is walked in RBS order and patients are pulled up — **only if they can physically get there**: `now + travelTime ≤ newSlotStart`. Patients already in the waiting room are always feasible. Infeasible patients are skipped and keep their place. |
| 4 | **CDM slot substitution** | Patients trade slots with each other | A clinic-mediated exchange market. Patients opt in with a preference ("earlier" / "later") and a maximum shift. A swap executes only if **both** are better off by their own preference — a Pareto improvement. |
| 5 | **Priority handling + aging** | Emergencies first, nobody starves | Emergency walk-ins preempt the queue, but every routine patient accrues priority while waiting. After `E / agingRate` minutes, they outrank any new emergency. |

## Fairness invariants (enforced in code, asserted in tests)

A juror will ask *"can someone game this?"* — [`tests/exchange.test.ts`](tests/exchange.test.ts) and
[`tests/rbs.test.ts`](tests/rbs.test.ts) are the answer.

1. **Nobody is moved later without consent.** Over full simulated days, every time a patient's slot index
   increases, it is checked to be the "later" side of a logged, opted-in swap. With the exchange disabled, nobody ever
   ends up behind their RBS slot.
2. **Only opted-in patients are ever swapped.** Declining the exchange means your slot is untouchable.
3. **Every swap is a strict Pareto improvement**, within each party's own stated max shift, and never violates a hard
   constraint (e.g. "cannot arrive before 15:00").
4. **No third party moves because of a swap.** Anyone else whose slot changed in the same step must have been pulled
   *earlier* by compression.
5. **Lying gains nothing.** Claiming "prefer earlier" can only move *you*, and only if someone genuinely volunteers to go later.
6. **Compression only moves people earlier**, and only when they can physically make it.
7. **Bounded wait under any emergency load:** head-of-line wait ≤ `max(E / agingRate, lateGrace) + longest consult`
   (tested at 2, 5 and 8 emergencies/hour; the same load with aging disabled demonstrably starves patients).
8. **Every decision is logged with its reason** — advisories, compressions, swaps, preemptions, late-arrival bypasses.

## Results — seed 42

`compare(42)` runs TARMAC and a baseline over the **identical** seeded patient stream: same consultation times,
same no-shows, cancellations, emergencies and doctor lateness. The baseline is today's reality: everyone is told to
come at session start and is seen first-come-first-served, with no advisories, no compression and no exchange.

| Metric | Baseline | TARMAC |
|---|---:|---:|
| Routine patients seen | 63 | 63 |
| Mean time in clinic (min) | 103.4 | **12.8** |
| Median time in clinic (min) | 92 | 7 |
| p90 time in clinic (min) | 193 | 34 |
| Max time in clinic (min) | 270 | 62 |
| Patient-hours in clinic | 108.5 | 13.5 |
| Doctor idle (min, all doctors) | 106 | 195 |
| Doctor overtime (min, all doctors) | 122 | 138 |
| Capacity wasted by no-shows (min) | 11 | 2 |
| Slots vacated (no-show / cancel) | 9 | 9 |
| Slots recovered by compression | 0 | 5 |
| Swaps executed | 0 | 9 |
| Advisories sent | 0 | 213 |
| Emergencies seen | 1 | 1 |

**TARMAC cuts mean time-in-clinic from 103.4 to 12.8 minutes (−87.6%), returning 95 patient-hours in one clinic day.**

**The trade-off:** holding patients at home means the doctor sometimes waits for the next patient to walk in.
Doctor idle time rises, and overtime rises slightly. The advisory percentile (`advisoryPercentile`, default p10)
trades patient waiting against doctor idle time. The improvement in time-in-clinic also holds on other seeds (tested on 1, 7 and 2026).

Time in clinic = actual arrival → consultation start, for routine patients.

## The app

- **Control tower** — each doctor's queue is drawn as a ship deck. Every container is a booked slot, coloured by where
  that patient physically is (at home, told to leave, on the way, in the waiting room, with the doctor, done).
  Change the declared call rate, announce a delay, insert an emergency.
- **Patient view** — a phone showing when to leave home, live queue position, the predicted-start band (p10–p90),
  slot-exchange opt-in, notifications, and "your wait today vs with TARMAC".
- **Metrics** — waiting-room headcount through the day for both policies, and the full comparison table.
- **Event log** — every advisory, compression and swap, with its reason.
- **Scripted demo** — one button, identical every replay: a normal morning, a doctor running late, two silent
  no-shows triggering compression, one emergency, and two patient swaps, ending on the metrics comparison.

## Determinism

Every random draw comes from one seeded PRNG (`mulberry32`). Independent sub-streams are derived from the master seed
with stable string labels, so the baseline and TARMAC consume the same patient stream no matter how many draws each
makes internally. The same seed gives byte-identical event logs and metrics (asserted in
[`tests/reproducibility.test.ts`](tests/reproducibility.test.ts)). Playback speed in the UI never affects results.

## Run it

Requires Node 18+.

```bash
npm install
npm run dev          # app at http://localhost:5173
npm test             # Vitest suite (52 tests)
npm run compare 42   # print the TARMAC vs baseline table for a seed
npm run build        # static site in dist/ — deployable to GitHub Pages, works offline
```

No backend, no database, no API keys, no network calls. Fonts are bundled locally.

## Project layout

```
src/engine/        pure TypeScript engine, zero UI / framework dependency
  rng.ts           seeded PRNG, normal CDF / inverse
  consultation.ts  lognormal consultation-time model (MLE fit, sample, mean, percentile, conditional remaining)
  generator.ts     seeded synthetic clinic day
  rbs.ts           Algorithm 1 — Ration By Schedule
  predict.ts       Monte Carlo start-time prediction (Algorithm 2)
  compression.ts   Algorithm 3 — feasibility-constrained compression
  exchange.ts      Algorithm 4 — Pareto slot exchange
  priority.ts      Algorithm 5 — emergency preemption with aging
  simulation.ts    TARMAC minute-by-minute simulation wiring all five together
  baseline.ts      BaselineScheduler — "everyone come at 9", FCFS
  metrics.ts       metrics + compare(seed)
  demo.ts          the scripted demo scenario
src/ui/            Vite + React + Tailwind + Recharts front end
tests/             Vitest suites
```

## Honest limitations

- **Synthetic data.** Patients, travel times and consultation durations are generated, not real. The consultation
  models are fitted to synthetic historical visits. The study figures above motivate the problem; they are not used
  as model inputs.
- **Single-clinic model.** One OPD with independent doctor queues. No shared resources (labs, pharmacy, imaging),
  no multi-department journeys, no patient re-visits within the day.
- **Behaviour model is simple.** Patients follow advisories with a small departure delay; a configurable fraction
  ignores them. Real compliance, traffic and smartphone access vary much more.
- **No real EMR / HIS integration**, no SMS gateway, and no authentication. Notifications are simulated.
- **Doctor idle time rises** under ground holding, as noted above. It is tunable but not free.
