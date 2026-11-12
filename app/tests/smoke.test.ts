import { describe, expect, it } from 'vitest';
import { shell } from '../src/shell';

describe('scaffold', () => {
  it('runs tests', () => {
    expect(1 + 1).toBe(2);
  });

  it('shell bridge reports a non-native environment under Vitest', () => {
    expect(shell.native).toBe(false);
  });
});
