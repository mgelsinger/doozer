// The view host: mounts exactly one view at a time (WORK_PLAN.md, section 3).
//
// Until the Pill view exists (Phase 6) the host shows the shell spike test page:
// a coloured blob and buttons that move the window between its shapes.
import { runSpikeScenarios } from './spike/scenarios';
import { mountTestPage } from './spike/test-page';

const host = document.getElementById('host');
if (!host) throw new Error('missing #host');

const page = await mountTestPage(host);
// Does nothing unless this is a spike build started with DOOZER_SPIKE set.
void runSpikeScenarios(page).catch((error: unknown) => console.error('[spike]', error));
