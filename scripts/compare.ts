import { compare } from '../src/engine';

const seed = Number(process.argv[2] ?? 42);
const t0 = performance.now();
const c = compare(seed);
const ms = Math.round(performance.now() - t0);

const rows: [string, keyof typeof c.baseline][] = [
  ['Routine patients seen', 'routinePatientsSeen'],
  ['Mean time in clinic (min)', 'meanTimeInClinic'],
  ['Median time in clinic (min)', 'medianTimeInClinic'],
  ['p90 time in clinic (min)', 'p90TimeInClinic'],
  ['Max time in clinic (min)', 'maxTimeInClinic'],
  ['Patient-hours in clinic', 'patientHoursInClinic'],
  ['Doctor idle (min, all doctors)', 'doctorIdleMinutes'],
  ['Doctor overtime (min, all doctors)', 'doctorOvertimeMinutes'],
  ['Capacity wasted by no-shows (min)', 'capacityWastedByNoShowsMinutes'],
  ['Slots vacated (no-show/cancel)', 'slotsVacated'],
  ['Slots recovered by compression', 'slotsRecoveredByCompression'],
  ['Swaps executed', 'swapsExecuted'],
  ['Advisories sent', 'advisoriesSent'],
  ['  of which revised', 'revisedAdvisories'],
  ['Emergencies seen', 'emergenciesSeen'],
];
console.log(`\nTARMAC vs BASELINE — seed ${seed}  (${ms} ms)\n`);
console.log(`| Metric | Baseline | TARMAC |\n|---|---:|---:|`);
for (const [label, key] of rows) console.log(`| ${label} | ${c.baseline[key]} | ${c.tarmac[key]} |`);
console.log(`\n${c.headline}`);
console.log(`p90 reduction: ${c.p90TimeInClinicReductionPct}%\n`);
