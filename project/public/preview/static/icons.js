const paths = {
  check: '<path d="m5 12 4 4L19 6"/>',
  edit: '<path d="m16 3 5 5-12 12-6 1 1-6L16 3Zm-2 2 5 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0v6l2 3H4l2-3V8Zm4 12h4"/>',
  repeat: '<path d="M4 8a8 8 0 0 1 14-3l2 3m0-5v5h-5M20 16a8 8 0 0 1-14 3l-2-3m0 5v-5h5"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
  theme: '<path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/>',
  auto: '<path d="M12 3a9 9 0 1 0 0 18V3Z"/><circle cx="12" cy="12" r="9"/>',
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V10Z"/><path d="M9 21v-7h6v7"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18"/>',
  tasks: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m7 12 3 3 7-7"/>',
  chart: '<path d="M4 20V11m5 9V5m5 15v-8m5 8V3M2 20h20"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9l2.1 2.1m10 10 2.1 2.1m0-14.2L17 7m-10 10-2.1 2.1"/>',
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/>',
};
export function icon(name) {
  return `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.check}</svg>`;
}
export function fillIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
}
