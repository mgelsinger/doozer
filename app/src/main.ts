// The view host: mounts exactly one view at a time (WORK_PLAN.md, section 3).
// Placeholder until the shell spike (Phase 3) and the Pill view (Phase 6) land.
import { shell } from './shell';

const host = document.getElementById('host');
if (!host) throw new Error('missing #host');

const blob = document.createElement('div');
blob.textContent = 'Doozer';
blob.style.cssText = [
  'position:fixed', 'left:50%', 'top:50%', 'translate:-50% -50%',
  'width:150px', 'height:130px', 'display:grid', 'place-items:center',
  'border-radius:50% 50% 46% 46% / 58% 58% 42% 42%',
  'background:#ffb38a', 'border:4px solid #3a2a35', 'color:#3a2a35', 'font-weight:700',
].join(';');
host.append(blob);

console.info(`[doozer] placeholder page, shell: ${shell.native ? 'tauri' : 'browser'}`);
