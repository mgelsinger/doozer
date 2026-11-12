// Shared palettes and icons, so every mockup draws from the same kit.

/** Doozer colourways. `line` is the outline colour, `ink` the eyes/mouth. */
export const PALETTES = {
  peach:    { name: 'Peach',    body: '#FFC7A1', light: '#FFE0C8', shade: '#F3A27A', belly: '#FFF3E6', cheek: '#FF8C8C', ear: '#FFA9A0', line: '#6B4636', ink: '#3A2A26' },
  mint:     { name: 'Mint',     body: '#A9E8CF', light: '#D2F6E7', shade: '#74CBAC', belly: '#F2FFF9', cheek: '#FF9CAB', ear: '#FFBDC8', line: '#2F5D50', ink: '#263B36' },
  lavender: { name: 'Lavender', body: '#CFC0F7', light: '#E6DCFF', shade: '#A692E2', belly: '#F8F3FF', cheek: '#FF9BC5', ear: '#FFBEDB', line: '#4B3F78', ink: '#2E2748' },
  butter:   { name: 'Butter',   body: '#FFE28E', light: '#FFF1C2', shade: '#F0BE4E', belly: '#FFFAE3', cheek: '#FF9B7B', ear: '#FFBB9F', line: '#6E5321', ink: '#3D2F17' },
  sky:      { name: 'Sky',      body: '#AED9FF', light: '#D6ECFF', shade: '#7CB7EE', belly: '#F3FAFF', cheek: '#FF9CB1', ear: '#FFC0CF', line: '#2E4E73', ink: '#22344D' },
};
export const PALETTE_KEYS = Object.keys(PALETTES);

const L = '#5B4636'; // icon outline
const svg = (body) => `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">${body}</svg>`;

/** 24x24 icons as SVG markup. */
export const ICONS = {
  feed: svg(`<path d="M12 3.4c1.5 0 2.6.9 3.5 2.4l4.5 8c1.6 2.9-.2 6.4-3.9 6.4H7.9c-3.7 0-5.5-3.5-3.9-6.400l4.500-8c.9-1.500 2-2.400 3.500-2.400z" fill="#fff" stroke="${L}" stroke-width="1.600" stroke-linejoin="round"/><path d="M8.600 13.800h6.800v6.400H8.600z" fill="#3F4B3B"/><circle cx="10" cy="9.800" r=".7" fill="${L}"/><circle cx="14" cy="9.800" r=".7" fill="${L}"/>`),
  play: svg(`<circle cx="12" cy="12" r="8.6" fill="#FF8FA3" stroke="${L}" stroke-width="1.6"/><path d="M4.300 9.300c4.600 2.300 10.800 2.300 15.400 0" fill="none" stroke="#fff" stroke-width="2.200" stroke-linecap="round"/><path d="M12 3.500c-2 5-2 12 0 17" fill="none" stroke="#fff" stroke-width="1.400" stroke-linecap="round" opacity=".7"/><circle cx="12" cy="12" r="8.600" fill="none" stroke="${L}" stroke-width="1.600"/>`),
  wash: svg(`<circle cx="9" cy="14.200" r="6" fill="#BFE8FF" stroke="${L}" stroke-width="1.600"/><circle cx="17.200" cy="7.800" r="3.800" fill="#D9F2FF" stroke="${L}" stroke-width="1.600"/><circle cx="18.600" cy="17.600" r="2.300" fill="#D9F2FF" stroke="${L}" stroke-width="1.400"/><path d="M6.200 12.800a3.200 3.200 0 0 1 2.300-2.300" fill="none" stroke="#fff" stroke-width="1.500" stroke-linecap="round"/>`),
  sleep: svg(`<path d="M15.400 3.600a8.600 8.600 0 1 0 5.200 12.300 7 7 0 0 1-5.200-12.300z" fill="#FFE08A" stroke="${L}" stroke-width="1.600" stroke-linejoin="round"/><path d="M19.300 3.400l.6 1.500 1.500.6-1.500.6-.6 1.500-.6-1.500-1.500-.6 1.500-.6z" fill="#FFE08A" stroke="${L}" stroke-width=".8" stroke-linejoin="round"/>`),
  wake: svg(`<circle cx="12" cy="12" r="4.600" fill="#FFD25E" stroke="${L}" stroke-width="1.600"/><path d="M12 2.800v2.400M12 18.800v2.400M2.800 12h2.400M18.800 12h2.400M5.500 5.500l1.700 1.700M16.800 16.800l1.700 1.700M5.500 18.500l1.700-1.700M16.800 7.200l1.700-1.700" stroke="${L}" stroke-width="1.600" stroke-linecap="round"/>`),
  heart: svg(`<path d="M12 20.400s-7.600-4.600-7.600-10.100A4.200 4.200 0 0 1 12 7.900a4.200 4.200 0 0 1 7.600 2.400c0 5.500-7.600 10.100-7.600 10.100z" fill="#FF7A93" stroke="${L}" stroke-width="1.600" stroke-linejoin="round"/>`),
  treat: svg(`<circle cx="12" cy="12" r="8.600" fill="#E9B872" stroke="${L}" stroke-width="1.600"/><circle cx="9" cy="9.400" r="1.400" fill="${L}"/><circle cx="14.600" cy="8.600" r="1.100" fill="${L}"/><circle cx="15.200" cy="14.200" r="1.500" fill="${L}"/><circle cx="9.600" cy="15.200" r="1.200" fill="${L}"/>`),
  mess: svg(`<path d="M12 4.200c1.700 1 2.500 2.300 2.100 3.900 2 .4 3.200 1.700 3 3.500 1.800.6 2.700 1.900 2.700 3.500 0 2.500-2.300 4.300-7.800 4.300s-7.800-1.800-7.800-4.300c0-1.600.9-2.900 2.700-3.500-.2-1.800 1-3.100 3-3.500-.4-1.600.5-2.900 2.100-3.900z" fill="#B98A5E" stroke="${L}" stroke-width="1.600" stroke-linejoin="round"/>`),
  stats: svg(`<rect x="3.800" y="12" width="4.400" height="8.200" rx="1.600" fill="#8FD3FF" stroke="${L}" stroke-width="1.400"/><rect x="9.800" y="7.400" width="4.400" height="12.800" rx="1.600" fill="#FFD25E" stroke="${L}" stroke-width="1.400"/><rect x="15.800" y="3.800" width="4.400" height="16.400" rx="1.600" fill="#FF8FA3" stroke="${L}" stroke-width="1.400"/>`),
  timer: svg(`<circle cx="12" cy="13" r="7.600" fill="#fff" stroke="${L}" stroke-width="1.600"/><path d="M12 9v4.200l2.600 1.600" fill="none" stroke="${L}" stroke-width="1.600" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.600 2.800h4.800" stroke="${L}" stroke-width="1.800" stroke-linecap="round"/>`),
};

/** Which icon and colour goes with each need. */
export const NEED_ART = {
  tummy:  { icon: 'feed',  color: '#FFA94D' },
  fun:    { icon: 'play',  color: '#FF7A93' },
  energy: { icon: 'sleep', color: '#F5C542' },
  clean:  { icon: 'wash',  color: '#5BBEF5' },
};

/** Traffic-light colour for a 0-100 need value. */
export function levelColor(v) {
  return v < 12 ? '#F0647A' : v < 30 ? '#F7A440' : v < 60 ? '#F5CF4A' : '#6FCF97';
}
