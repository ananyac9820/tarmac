/**
 * Real-data no-show model, fitted from an appointment log CSV.
 *
 * Designed for the public "Medical Appointment No Shows" dataset (Kaggle,
 * ~110k appointments; columns ScheduledDay, AppointmentDay, Age,
 * SMS_received, No-show), and tolerant of similar exports from a clinic's
 * own HIS: column names are matched loosely.
 */

export interface RateRow {
  label: string;
  n: number;
  noShows: number;
  rate: number;
}

export interface NoShowModel {
  source: string;
  rows: number;
  noShows: number;
  rate: number;
  byLeadTime: RateRow[];
  bySms: RateRow[];
  byAge: RateRow[];
  byWeekday: RateRow[];
}

const LEAD_BUCKETS: [string, number, number][] = [
  ['Same day', 0, 0],
  ['1–2 days', 1, 2],
  ['3–7 days', 3, 7],
  ['8–14 days', 8, 14],
  ['15–30 days', 15, 30],
  ['31+ days', 31, Infinity],
];
const AGE_BUCKETS: [string, number, number][] = [
  ['0–12', 0, 12],
  ['13–25', 13, 25],
  ['26–45', 26, 45],
  ['46–65', 46, 65],
  ['66+', 66, 200],
];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Minimal RFC-4180 CSV line splitter (handles quoted commas). */
function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

function findCol(header: string[], ...candidates: string[]): number {
  const h = header.map(norm);
  for (const c of candidates) {
    const i = h.indexOf(norm(c));
    if (i >= 0) return i;
  }
  return -1;
}

function truthy(v: string): boolean {
  const t = v.trim().toLowerCase();
  return t === 'yes' || t === '1' || t === 'true' || t === 'y' || t === 'no_show' || t === 'noshow';
}

export class NoShowParseError extends Error {}

export function fitNoShowModel(csv: string, source = 'uploaded CSV'): NoShowModel {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length);
  if (lines.length < 2) throw new NoShowParseError('The file has no data rows.');
  const header = splitLine(lines[0]);
  const iShow = findCol(header, 'No-show', 'noshow', 'no_show', 'missed', 'status');
  const iSched = findCol(header, 'ScheduledDay', 'scheduled_day', 'booked_at', 'bookingdate', 'scheduled');
  const iAppt = findCol(header, 'AppointmentDay', 'appointment_day', 'appointmentdate', 'date');
  const iAge = findCol(header, 'Age');
  const iSms = findCol(header, 'SMS_received', 'sms', 'reminder');
  if (iShow < 0) throw new NoShowParseError('Could not find a "No-show" column.');

  const lead = LEAD_BUCKETS.map(([label]) => ({ label, n: 0, noShows: 0 }));
  const age = AGE_BUCKETS.map(([label]) => ({ label, n: 0, noShows: 0 }));
  const sms = [
    { label: 'No SMS reminder', n: 0, noShows: 0 },
    { label: 'SMS reminder sent', n: 0, noShows: 0 },
  ];
  const wd = WEEKDAYS.map((label) => ({ label, n: 0, noShows: 0 }));
  let rows = 0;
  let total = 0;

  for (let li = 1; li < lines.length; li++) {
    const c = splitLine(lines[li]);
    if (c.length < header.length - 1) continue;
    const ns = truthy(c[iShow] ?? '') || /^missed|^no.?show/i.test(c[iShow] ?? '');
    rows++;
    if (ns) total++;
    if (iSched >= 0 && iAppt >= 0) {
      const s = Date.parse(c[iSched]);
      const a = Date.parse(c[iAppt]);
      if (!Number.isNaN(s) && !Number.isNaN(a)) {
        const days = Math.max(0, Math.floor((Date.UTC(new Date(a).getUTCFullYear(), new Date(a).getUTCMonth(), new Date(a).getUTCDate()) - Date.UTC(new Date(s).getUTCFullYear(), new Date(s).getUTCMonth(), new Date(s).getUTCDate())) / 86400000));
        const b = LEAD_BUCKETS.findIndex(([, lo, hi]) => days >= lo && days <= hi);
        if (b >= 0) {
          lead[b].n++;
          if (ns) lead[b].noShows++;
        }
        const w = wd[new Date(a).getUTCDay()];
        w.n++;
        if (ns) w.noShows++;
      }
    }
    if (iAge >= 0) {
      const ag = Number(c[iAge]);
      const b = AGE_BUCKETS.findIndex(([, lo, hi]) => ag >= lo && ag <= hi);
      if (b >= 0) {
        age[b].n++;
        if (ns) age[b].noShows++;
      }
    }
    if (iSms >= 0) {
      const r = sms[truthy(c[iSms] ?? '') ? 1 : 0];
      r.n++;
      if (ns) r.noShows++;
    }
  }
  if (rows === 0) throw new NoShowParseError('No usable rows found.');
  const fin = (xs: { label: string; n: number; noShows: number }[]): RateRow[] =>
    xs.filter((x) => x.n > 0).map((x) => ({ ...x, rate: x.noShows / x.n }));
  return {
    source,
    rows,
    noShows: total,
    rate: total / rows,
    byLeadTime: fin(lead),
    bySms: fin(sms),
    byAge: fin(age),
    byWeekday: fin(wd),
  };
}

/** No-show probability for a booking made `leadDays` before the visit. */
export function noShowRisk(model: NoShowModel, leadDays: number): number {
  const b = LEAD_BUCKETS.find(([, lo, hi]) => leadDays >= lo && leadDays <= hi);
  return model.byLeadTime.find((r) => r.label === b?.[0])?.rate ?? model.rate;
}
