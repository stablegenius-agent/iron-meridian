// SF Symbols-style line icons (24x24, stroke = currentColor). One consistent set replaces the unicode glyphs,
// which rendered differently on every OS. icon(name, size) returns an inline SVG string.
const P = {
  // transport / chrome
  pause: '<rect x="6.5" y="5" width="3.6" height="14" rx="1.2" fill="currentColor" stroke="none"/><rect x="13.9" y="5" width="3.6" height="14" rx="1.2" fill="currentColor" stroke="none"/>',
  play: '<path d="M7.5 5.2v13.6a.8.8 0 0 0 1.2.7l10.6-6.8a.8.8 0 0 0 0-1.4L8.7 4.5a.8.8 0 0 0-1.2.7z" fill="currentColor" stroke="none"/>',
  forward: '<path d="M3 6.2v11.6a.7.7 0 0 0 1.1.6l8.4-5.8a.7.7 0 0 0 0-1.2L4.1 5.6a.7.7 0 0 0-1.1.6zM12 6.2v11.6a.7.7 0 0 0 1.1.6l8.4-5.8a.7.7 0 0 0 0-1.2l-8.4-5.8a.7.7 0 0 0-1.1.6z" fill="currentColor" stroke="none"/>',
  forward3: '<path d="M1.5 7v10a.6.6 0 0 0 1 .5l6.3-5a.6.6 0 0 0 0-1l-6.3-5a.6.6 0 0 0-1 .5zM8.7 7v10a.6.6 0 0 0 1 .5l6.3-5a.6.6 0 0 0 0-1l-6.3-5a.6.6 0 0 0-1 .5zM15.9 7v10a.6.6 0 0 0 1 .5l5.3-5a.6.6 0 0 0 0-1l-5.3-5a.6.6 0 0 0-1 .5z" fill="currentColor" stroke="none"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  chevron: '<path d="M9 5l7 7-7 7"/>',
  menu: '<circle cx="12" cy="12" r="9"/><circle cx="8" cy="12" r=".9" fill="currentColor"/><circle cx="12" cy="12" r=".9" fill="currentColor"/><circle cx="16" cy="12" r=".9" fill="currentColor"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.6"/><circle cx="12" cy="17" r=".9" fill="currentColor"/>',
  warning: '<path d="M10.3 4.3L2.9 17.5A2 2 0 0 0 4.6 20.5h14.8a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4.5"/><circle cx="12" cy="17" r=".9" fill="currentColor"/>',
  threats: '<path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.2-7.5 9.5-4.3-1.3-7.5-4.9-7.5-9.5V6z"/><path d="M12 8v4.5"/><circle cx="12" cy="15.8" r=".9" fill="currentColor"/>',
  cart: '<path d="M3.5 4.5h2.2l2.2 10.8h10.4l2-7.8H7"/><circle cx="9.5" cy="19" r="1.3"/><circle cx="17" cy="19" r="1.3"/>',
  recall: '<path d="M9 14L4.5 9.5 9 5"/><path d="M4.5 9.5h9.5a5.5 5.5 0 0 1 0 11H11"/>',
  pin: '<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  person3: '<circle cx="12" cy="8" r="2.6"/><path d="M7.3 18.5a4.7 4.7 0 0 1 9.4 0"/><circle cx="5.3" cy="10" r="1.9"/><path d="M1.8 17.5a3.6 3.6 0 0 1 4.6-3.4"/><circle cx="18.7" cy="10" r="1.9"/><path d="M22.2 17.5a3.6 3.6 0 0 0-4.6-3.4"/>',
  medal: '<circle cx="12" cy="15" r="5"/><path d="M9 3l3 6.5L15 3M7 3h3M14 3h3"/><path d="M12 12.6l.8 1.6 1.7.2-1.2 1.2.3 1.7-1.6-.8-1.6.8.3-1.7-1.2-1.2 1.7-.2z" fill="currentColor" stroke="none"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3z"/>',
  // unit types
  fighter: '<path d="M12 2.5l1.6 5.2 7.4 5.3v2l-7.2-2.4-.5 5.2 2.7 2v1.7L12 20.4l-4 1.1v-1.7l2.7-2-.5-5.2L3 15v-2l7.4-5.3z"/>',
  bomber: '<path d="M12 6l10 8.5-3 .8-2.2-1.5-2 1.6L12 13.2l-2.8 2.2-2-1.6L5 15.3l-3-.8z"/>',
  drone: '<path d="M12 4.5v15M3 11.5l9-2 9 2M8.5 19.5h7"/><circle cx="12" cy="4.5" r="1.2"/>',
  sof: '<circle cx="12" cy="5" r="2.2"/><path d="M12 7.5v6.5M12 14l-3.5 6.5M12 14l3.5 6.5M6.5 10.5l5.5-1.5 5.5 1.5"/>',
  airborne: '<path d="M3.5 10a8.5 6 0 0 1 17 0z"/><path d="M3.5 10L12 18.5 20.5 10M9 10l3 8.5 3-8.5"/><circle cx="12" cy="20" r="1.2"/>',
  armor: '<rect x="3" y="12" width="18" height="6" rx="3"/><path d="M7 12V9.5h8.5V12M15.5 10.5H21"/><circle cx="7.5" cy="15" r=".9" fill="currentColor"/><circle cx="12" cy="15" r=".9" fill="currentColor"/><circle cx="16.5" cy="15" r=".9" fill="currentColor"/>',
  carrier: '<path d="M2 14.5h20l-2.5 4.5H4.5z"/><path d="M5 14.5V12h14v2.5M14.5 12V8.5h2.5V12"/>',
  destroyer: '<path d="M2 15h20l-3 4H5z"/><path d="M7 15v-3h8v3M10 12V8h3v4M11.5 8V5"/>',
  submarine: '<path d="M3 14.5c0-2.2 2-3.5 5-3.5h9c2.8 0 4 1.6 4 3.5s-1.2 3.5-4 3.5H8c-3 0-5-1.3-5-3.5z"/><path d="M10 11V8h3.5v3M12 8V5.5"/>',
  cyber: '<rect x="6" y="6" width="12" height="12" rx="2.5"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
  satellite: '<rect x="9.5" y="9.5" width="5" height="5" rx="1" transform="rotate(45 12 12)"/><path d="M5.5 5.5l3 3M15.5 15.5l3 3"/><rect x="1.5" y="3.5" width="6" height="3" rx=".6" transform="rotate(45 4.5 5)"/><rect x="16.5" y="17.5" width="6" height="3" rx=".6" transform="rotate(45 19.5 19)"/><path d="M15 6.5a3 3 0 0 1 2.5 2.5"/>',
  orbital: '<path d="M12 2.5v13"/><path d="M8.5 12.5L12 16l3.5-3.5"/><path d="M5 19.5c2-1.3 4.4-2 7-2s5 .7 7 2"/><path d="M3 6.5h4M17 6.5h4"/>',
  // operations
  recon: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  aid: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z"/><path d="M12 10v5M9.5 12.5h5"/>',
  patrol: '<path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.2-7.5 9.5-4.3-1.3-7.5-4.9-7.5-9.5V6z"/><path d="M8.5 12l2.4 2.4 4.6-4.8"/>',
  cyber_ad: '<path d="M5 12.5a10 10 0 0 1 14 0M8 15.5a5.5 5.5 0 0 1 8 0"/><circle cx="12" cy="18.5" r=".9" fill="currentColor"/><path d="M3.5 3.5l17 17"/>',
  strike: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4"/>',
  raid: '<path d="M13.5 2.5L5 13.5h6.5L10.5 21.5 19 10.5h-6.5z"/>',
  cyber_grid: '<path d="M13 2.5L5.5 13H12l-1 8.5L18.5 11H12z"/><path d="M3 3l18 18"/>',
  blockade: '<circle cx="12" cy="5" r="2"/><path d="M12 7v13.5M7.5 10.5h9M4 14a8 8 0 0 0 16 0"/>',
  campaign: '<path d="M7 4.5l1 3.4 5 3.6v1.3l-4.8-1.6-.3 3.4 1.8 1.3v1.1L7 16.3 4.3 17v-1.1l1.8-1.3-.3-3.4L1 12.8v-1.3l5-3.6z" transform="translate(1 1)"/><path d="M16 4.5l1 3.4 5 3.6v1.3l-4.8-1.6-.3 3.4 1.8 1.3v1.1L16 16.3 13.3 17v-1.1l1.8-1.3-.3-3.4-4.8 1.6v-1.3l5-3.6z" transform="translate(0 2.5)"/>',
  invade: '<path d="M5 21V3.5"/><path d="M5 4h12.5l-2.5 4 2.5 4H5"/>',
  talks: '<path d="M4 5.5h11a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H9l-4 3.5v-3.5H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2z"/><path d="M19.5 9.5h.5a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-1v3l-3.5-3H12"/>',
  war: '<path d="M12 21.5c-4 0-7-2.6-7-6.6 0-3.9 3.3-6 3.8-10.4 2.2 1.4 3.3 3.2 3.4 5.5 1-.9 1.6-2 1.8-3.4 2.6 2 5 4.8 5 8.3 0 4-3 6.6-7 6.6z"/><path d="M12 21.5c-1.7 0-3-1.2-3-3 0-2.1 2-3 3-5 1 2 3 2.9 3 5 0 1.8-1.3 3-3 3z"/>',
  site: '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/>',
  cell: '<circle cx="12" cy="9" r="5.5"/><path d="M9.3 9.2h.01M14.7 9.2h.01" stroke-width="2.6"/><path d="M9.5 14.5v2.5l1.2-.8 1.3.8 1.3-.8 1.2.8v-2.5"/><path d="M5 19.5l14 2M19 19.5L5 21.5"/>',
};
// Aliases so data keys map straight to icons.
P.air = P.fighter; P.naval = P.destroyer; P.ground = P.armor; P.space = P.satellite;

export function icon(name, size = 18, cls = '') {
  const p = P[name] || P.site;
  return `<svg class="i ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}
