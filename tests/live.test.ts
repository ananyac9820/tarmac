import { describe, expect, it } from 'vitest';
import {
  ConsultationTimeModel,
  book,
  callNext,
  checkIn,
  createLiveState,
  finishCurrent,
  fitNoShowModel,
  liveModel,
  markOnTheWay,
  nextFor,
  refresh,
  setExchange,
  vacate,
  addEmergency,
  type LiveState,
} from '../src/engine';

const H = (h: number, m = 0) => h * 60 + m;

function clinic(): LiveState {
  return createLiveState('2026-11-26', [
    { id: 'D1', name: 'Dr. A', specialty: 'Gen Med', room: 'Room 1', sessionStart: H(9), sessionEnd: H(13), callRatePerHour: 6, model: ConsultationTimeModel.fromMedian(8, 0.3) },
  ]);
}
const bk = (s: LiveState, name: string, travel: number, now = H(7)) =>
  book(s, { name, phone: '', doctorId: 'D1', travelMinutes: travel, bookedAtMs: s.patients.length }, now);

describe('LiveClinic — the algorithms on real actions', () => {
  it('RBS: bookings take slots in booking order at the call rate', () => {
    const s = clinic();
    const a = bk(s, 'A', 20);
    const b = bk(s, 'B', 20);
    expect(a.token).toBe(1);
    expect(s.slots.D1.map((x) => x.scheduledStart)).toEqual([H(9), H(9, 10)]);
    expect(b.slotIndex).toBe(1);
  });

  it('never gives a new booking a slot it cannot physically reach', () => {
    const s = clinic();
    const p = book(s, { name: 'Late', phone: '', doctorId: 'D1', travelMinutes: 40, bookedAtMs: 0 }, H(10, 2));
    expect(s.slots.D1[p.slotIndex!].scheduledStart).toBeGreaterThanOrEqual(H(10, 42));
  });

  it('ground holding: issues leave-home advisories and LEAVE_NOW at the right time', () => {
    const s = clinic();
    const p = bk(s, 'A', 30);
    refresh(s, H(7));
    expect(p.advisedDeparture).not.toBeNull();
    expect(p.advisedDeparture!).toBeLessThanOrEqual(H(9) - 30);
    expect(p.leaveNowAt).toBeNull();
    refresh(s, p.advisedDeparture!);
    expect(p.leaveNowAt).toBe(p.advisedDeparture);
  });

  it('compression: a no-show pulls up the next patient who can make it', () => {
    const s = clinic();
    const a = bk(s, 'A', 10);
    const far = bk(s, 'Far', 120);
    const near = bk(s, 'Near', 5);
    vacate(s, a.id, 'NO_SHOW', H(8, 40));
    expect(far.slotIndex).toBe(1); // can't make 09:00 from 2h away
    expect(near.slotIndex).toBe(0);
  });

  it('exchange: swaps only opted-in patients who are both better off', () => {
    const s = clinic();
    const a = bk(s, 'A', 10);
    const b = bk(s, 'B', 10);
    const c = bk(s, 'C', 10);
    setExchange(s, a.id, true, 'PREFER_LATER', H(7));
    setExchange(s, c.id, true, 'PREFER_EARLIER', H(7));
    refresh(s, H(7));
    expect(a.slotIndex).toBe(2);
    expect(c.slotIndex).toBe(0);
    expect(b.slotIndex).toBe(1); // bystander untouched
  });

  it('calling order: protects an on-time patient on their way, emergencies preempt', () => {
    const s = clinic();
    const a = bk(s, 'A', 20);
    const b = bk(s, 'B', 20);
    refresh(s, H(8, 30));
    markOnTheWay(s, a.id, H(8, 50)); // ETA 09:10
    checkIn(s, b.id, H(8, 55));
    const d = nextFor(s, 'D1', H(9));
    expect(d.next).toBeNull();
    expect(d.waitingFor?.id).toBe(a.id);
    const e = addEmergency(s, 'E', 'D1', H(9));
    expect(callNext(s, 'D1', H(9))?.id).toBe(e.id);
  });

  it('learns from real consult durations', () => {
    const s = clinic();
    const doc = s.doctors[0];
    const before = liveModel(doc, s.config.priorWeight).median();
    for (let i = 0; i < 12; i++) {
      const p = book(s, { name: `P${i}`, phone: '', doctorId: 'D1', travelMinutes: 0, bookedAtMs: i, walkIn: true }, H(9));
      callNext(s, 'D1', H(9) + i * 20, p.id);
      finishCurrent(s, 'D1', H(9) + i * 20 + 18);
    }
    expect(doc.observed).toHaveLength(12);
    expect(liveModel(doc, s.config.priorWeight).median()).toBeGreaterThan(before + 4);
    expect(s.events.some((e) => e.type === 'MODEL_UPDATED')).toBe(true);
  });
});

describe('No-show model from a real appointment log', () => {
  it('fits rates by lead time and SMS from a Kaggle-format CSV', () => {
    const csv = [
      'PatientId,AppointmentID,Gender,ScheduledDay,AppointmentDay,Age,Neighbourhood,Scholarship,Hipertension,Diabetes,Alcoholism,Handcap,SMS_received,No-show',
      '1,1,F,2016-04-29T18:38:08Z,2016-04-29T00:00:00Z,62,X,0,1,0,0,0,0,No',
      '2,2,M,2016-04-29T16:08:27Z,2016-04-29T00:00:00Z,56,X,0,0,0,0,0,0,No',
      '3,3,F,2016-04-20T08:00:00Z,2016-05-10T00:00:00Z,30,X,0,0,0,0,0,1,Yes',
      '4,4,F,2016-04-20T08:00:00Z,2016-05-10T00:00:00Z,30,X,0,0,0,0,0,0,No',
    ].join('\n');
    const m = fitNoShowModel(csv);
    expect(m.rows).toBe(4);
    expect(m.rate).toBeCloseTo(0.25);
    expect(m.byLeadTime.find((r) => r.label === 'Same day')!.rate).toBe(0);
    expect(m.byLeadTime.find((r) => r.label === '15–30 days')!.rate).toBe(0.5);
    expect(m.bySms.find((r) => r.label === 'SMS reminder sent')!.rate).toBe(1);
  });
});

describe('LiveClinic regression: a silent no-show must not hold the queue hostage', () => {
  it('stops planning around a patient who never acknowledged LEAVE_NOW', () => {
    const s = clinic();
    const a = bk(s, 'Silent', 20);
    const b = bk(s, 'B', 20);
    refresh(s, H(8, 30));
    refresh(s, a.advisedDeparture!); // a is pinged
    expect(a.leaveNowAt).not.toBeNull();
    const before = b.prediction!.p50;
    for (let t = a.leaveNowAt! + 1; t <= H(10); t++) refresh(s, t); // a stays silent for ages
    expect(b.prediction!.p50).toBeLessThanOrEqual(Math.max(before, H(9, 30)));
    expect(b.leaveNowAt).not.toBeNull();
  });
});
