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

// ---- The content security policy, watched (docs/release.md, "The content security policy") ----

/** Something the page tried to do and the policy refused. */
export interface PolicyViolation {
  /** The directive that refused it (`style-src-attr`, `connect-src`, ...). */
  directive: string;
  /** What was refused: an address, or `inline`, `eval`, `data`, `blob`. */
  blocked: string;
  /** Where in the page's code it was tried, if the browser says. */
  at: string;
  /** In the page itself, or in a frame of it (the Island's engine lives in one). */
  where: string;
}

const violations: PolicyViolation[] = [];

function listenIn(doc: Document, where: string): void {
  doc.addEventListener('securitypolicyviolation', (event) => {
    violations.push({
      directive: event.effectiveDirective || event.violatedDirective,
      blocked: event.blockedURI || '(nothing named)',
      at: event.sourceFile ? `${event.sourceFile.replace(/^.*\//, '')}:${event.lineNumber}` : '',
      where,
    });
  });
}

/**
 * Start noting everything the policy refuses, in this page and in any frame it opens. A
 * scripted run calls this before the app starts; every runner then fails each of its
 * checks if anything was refused (`addPolicyFailures`), so a policy that has become too
 * strict for something the app really does cannot go unnoticed in a run that otherwise
 * looks fine. (A frame's own document is listened to from the moment it has loaded; what
 * the policy refuses while that document is still being read is not seen from here.)
 */
export function watchPolicy(): void {
  listenIn(document, 'page');
  const adopt = (frame: HTMLIFrameElement): void => {
    const listen = (): void => {
      try {
        if (frame.contentDocument) listenIn(frame.contentDocument, 'frame');
      } catch { /* not ours to look into */ }
    };
    frame.addEventListener('load', listen);
    if (frame.contentDocument?.readyState === 'complete') listen();
  };
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof HTMLIFrameElement) adopt(node);
        else if (node instanceof Element) node.querySelectorAll('iframe').forEach(adopt);
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
}

/**
 * Add a failure to every check of a run if the policy refused anything during it.
 * Returns what was refused, for the report.
 */
export function addPolicyFailures(results: Record<string, unknown>): PolicyViolation[] {
  if (violations.length === 0) return [];
  const first = violations[0] as PolicyViolation;
  const line = `the content security policy refused ${violations.length} thing${violations.length === 1 ? '' : 's'} during this run; the first: ${first.directive} refused ${first.blocked}${first.at ? ` at ${first.at}` : ''} (in the ${first.where})`;
  for (const result of Object.values(results)) {
    const failures = (result as { failures?: unknown } | null)?.failures;
    if (Array.isArray(failures)) failures.push(line);
  }
  return [...violations];
}

/** What the policy has refused so far (for a run that wants to look for itself). */
export function policyViolations(): readonly PolicyViolation[] {
  return violations;
}
