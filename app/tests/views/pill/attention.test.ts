import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Attention } from '../../../src/views/pill/attention';

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

function make(maxMs?: number) {
  const changes: boolean[] = [];
  const attention = new Attention({ onChange: (lively) => void changes.push(lively), now: () => Date.now(), maxMs });
  return { attention, changes };
}

describe('attention: lively only while there is a reason to be', () => {
  it('starts still', () => {
    const { attention, changes } = make();
    expect(attention.lively).toBe(false);
    expect(changes).toEqual([]);
  });

  it('a poke makes it lively for that long, then it goes still by itself', () => {
    const { attention, changes } = make();
    attention.poke(3000);
    expect(attention.lively).toBe(true);
    vi.advanceTimersByTime(2999);
    expect(attention.lively).toBe(true);
    vi.advanceTimersByTime(1);
    expect(attention.lively).toBe(false);
    expect(changes).toEqual([true, false]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('more pokes extend it without flickering', () => {
    const { attention, changes } = make();
    attention.poke(2000);
    vi.advanceTimersByTime(1500);
    attention.poke(2000);
    vi.advanceTimersByTime(1500);
    expect(attention.lively).toBe(true);
    vi.advanceTimersByTime(500);
    expect(attention.lively).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  it('a shorter poke never cuts a longer one short', () => {
    const { attention } = make();
    attention.poke(9000);
    attention.poke(500);
    vi.advanceTimersByTime(8999);
    expect(attention.lively).toBe(true);
    vi.advanceTimersByTime(1);
    expect(attention.lively).toBe(false);
  });

  it('no poke lasts longer than the limit, however long it asks for', () => {
    const { attention } = make(5000);
    attention.poke(1e12);
    vi.advanceTimersByTime(5000);
    expect(attention.lively).toBe(false);
  });

  it('a stream of pokes cannot build a pile of timers', () => {
    const { attention } = make();
    for (let i = 0; i < 500; i++) {
      attention.poke(6000);
      vi.advanceTimersByTime(16);
    }
    expect(vi.getTimerCount()).toBe(1);
  });

  it('rest goes still at once and leaves no timer', () => {
    const { attention, changes } = make();
    attention.poke(9000);
    attention.rest();
    expect(attention.lively).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(changes).toEqual([true, false]);
  });

  it('while disabled (tucked away) pokes are ignored', () => {
    const { attention, changes } = make();
    attention.poke(9000);
    attention.setEnabled(false);
    attention.poke(9000);
    expect(attention.lively).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    attention.setEnabled(true);
    attention.poke(1000);
    expect(changes).toEqual([true, false, true]);
  });

  it('nothing happens after destroy', () => {
    const { attention, changes } = make();
    attention.poke(9000);
    attention.destroy();
    attention.poke(9000);
    vi.advanceTimersByTime(20_000);
    expect(changes).toEqual([true]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores nonsense', () => {
    const { attention } = make();
    attention.poke(0);
    attention.poke(-5);
    attention.poke(Number.NaN);
    expect(attention.lively).toBe(false);
  });
});
