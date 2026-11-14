// Is this a scripted test run? (docs/shell-spike.md section 9.)
//
// A build made with `--features spike` and started with DOOZER_SPIKE set runs one or
// more scenarios and quits. A normal build always answers `enabled: false`, and none of
// the scenario code is even loaded (main.ts imports it on demand).

import { invoke } from '@tauri-apps/api/core';
import { shell } from '../shell';

export interface TestRun {
  enabled: boolean;
  /** Scenario names, comma separated. Names starting with `app-` run against the real app. */
  scenario?: string;
  args?: Record<string, unknown> | null;
  out?: string;
  cloaked?: boolean;
  debugBuild?: boolean;
}

export async function readTestRun(): Promise<TestRun> {
  if (!shell.native) return { enabled: false };
  try {
    return await invoke<TestRun>('spike_config');
  } catch {
    return { enabled: false };
  }
}

export function scenarioNames(run: TestRun): string[] {
  return (run.scenario ?? '').split(',').map((name) => name.trim()).filter(Boolean);
}

/** True when the run is about the app itself rather than the shell's test page. */
export function isAppRun(run: TestRun): boolean {
  return run.enabled && scenarioNames(run).some((name) => name.startsWith('app-'));
}
