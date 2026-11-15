import { describe, expect, it } from 'vitest';
import { createBrain, type Brain, type NeedKey } from '../../../src/core';
import { favouriteLine, pillFace } from '../../../src/views/pill/face';
import { MIN, START, fakeClock, seeded } from '../../core/helpers';

function pet(needs: Partial<Record<NeedKey, number>> = {}): { brain: Brain; clock: ReturnType<typeof fakeClock> } {
  const clock = fakeClock(START);
  const brain = createBrain({ now: clock.now, random: seeded(3), debug: true });
  brain.debug?.setNeeds({ tummy: 80, fun: 80, energy: 80, clean: 80, ...needs });
  return { brain, clock };
}
const face = (brain: Brain) => pillFace(brain.state, brain.limits);

describe('the pill face', () => {
  it('says how Doozer is, plainly, with a ring for wellbeing', () => {
    const { brain } = pet();
    expect(face(brain)).toMatchObject({
      name: 'Doozer', status: 'is overjoyed', statusTone: 'plain',
      ring: { kind: 'wellbeing', percent: 80, tone: 'good', icon: 'heart' },
    });
    brain.debug?.setNeeds({ tummy: 60, fun: 60, energy: 60, clean: 60 });
    expect(face(brain).status).toBe('is content');
    brain.debug?.setNeeds({ tummy: 45, fun: 45, energy: 45, clean: 45 });
    expect(face(brain)).toMatchObject({ status: 'is so-so', statusTone: 'plain', ring: { percent: 45, tone: 'fair' } });
  });

  it('turns amber, in words and colour, when a need is low', () => {
    const { brain } = pet({ tummy: 22 });
    const f = face(brain);
    expect(f).toMatchObject({ status: 'is hungry', statusTone: 'low' });
    // The ring is long (the average is fine) but takes the colour of the need that is low.
    expect(f.ring).toMatchObject({ kind: 'wellbeing', percent: 66, tone: 'low', icon: 'feed' });
  });

  it('names each low need', () => {
    expect(face(pet({ fun: 20 }).brain).status).toBe('wants to play');
    expect(face(pet({ energy: 20 }).brain).status).toBe('is sleepy');
    expect(face(pet({ clean: 20 }).brain).status).toBe('needs a bath');
  });

  it('says so in different words when a need is urgent: colour is never the only signal', () => {
    const { brain } = pet({ tummy: 6 });
    expect(face(brain)).toMatchObject({ status: 'is very hungry', statusTone: 'urgent', ring: { tone: 'urgent' } });
    expect(face(pet({ energy: 8 }).brain).status).toBe('is worn out');
    expect(face(pet({ clean: 5 }).brain).status).toBe('is very grubby');
    expect(face(pet({ fun: 5 }).brain).status).toBe('is very bored');
  });

  it('is calm about a sleeping Doozer even when a need is low', () => {
    const { brain } = pet({ energy: 40, tummy: 20 });
    brain.sleep();
    expect(face(brain)).toMatchObject({ status: 'is napping', statusTone: 'plain', ring: { icon: 'z' } });
  });

  it('becomes a countdown while a session runs, and the ring fills as time passes', () => {
    const { brain, clock } = pet();
    brain.startFocus();
    expect(face(brain)).toMatchObject({ status: '25:00', statusTone: 'focus', ring: { kind: 'focus', percent: 0, tone: 'focus', icon: 'timer' } });
    clock.advance(10 * MIN);
    brain.tick();
    expect(face(brain)).toMatchObject({ status: '15:00', ring: { kind: 'focus', percent: 40 } });
    expect(face(brain).label).toContain('15:00 left of 25 minutes');
  });

  it('with nobody looking, a running session is counted in whole minutes', () => {
    const { brain, clock } = pet();
    brain.startFocus();
    const quiet = () => pillFace(brain.state, brain.limits, false);
    expect(quiet()).toMatchObject({ status: '25 min', statusTone: 'focus', ring: { kind: 'focus', percent: 0 } });
    clock.advance(10 * MIN + 20_000);
    brain.tick();
    expect(quiet().status).toBe('15 min');
    expect(quiet().label).toContain('15 min left of 25 minutes');
    // The ring is the same either way: it fills by the percent.
    expect(quiet().ring).toEqual(face(brain).ring);
    // The last minute is counted in seconds whoever is looking.
    clock.advance(14 * MIN);
    brain.tick();
    expect(quiet().status).toBe('00:40');
    // A paused session stands still: it is shown exactly.
    brain.pauseFocus();
    expect(quiet().status.endsWith('00:40')).toBe(true);
  });

  it('shows nothing but the timer during a session, even with a need urgent (spec 4.5)', () => {
    const { brain } = pet();
    brain.startFocus();
    brain.debug?.setNeeds({ tummy: 3 });
    expect(face(brain)).toMatchObject({ status: '25:00', statusTone: 'focus', ring: { kind: 'focus', tone: 'focus' } });
  });

  it('says paused, with the time left', () => {
    const { brain, clock } = pet();
    brain.startFocus();
    clock.advance(5 * MIN);
    brain.tick();
    brain.pauseFocus();
    const f = face(brain);
    expect(f.status.startsWith('paused')).toBe(true);
    expect(f.status.endsWith('20:00')).toBe(true);
    expect(f).toMatchObject({ statusTone: 'plain', ring: { kind: 'focus', percent: 20 } });
  });

  it('goes back to the mood when the session is over', () => {
    const { brain } = pet();
    brain.startFocus();
    brain.debug?.finishFocusNow();
    expect(face(brain)).toMatchObject({ status: 'is overjoyed', ring: { kind: 'wellbeing' } });
  });

  it('keeps every status short enough for the pill', () => {
    const paused = pet();
    paused.brain.setFocusLength(50);
    paused.brain.startFocus();
    paused.brain.pauseFocus();
    const lines = [
      ...(['tummy', 'fun', 'energy', 'clean'] as const).flatMap((key) => [face(pet({ [key]: 20 }).brain).status, face(pet({ [key]: 5 }).brain).status]),
      face(paused.brain).status,
      ...(['biscuit', 'cookie', 'donut', 'strawberry', 'onigiri'] as const).map(favouriteLine),
    ];
    for (const line of lines) expect(line.length, line).toBeLessThanOrEqual(18);
  });
});
