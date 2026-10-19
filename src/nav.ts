/**
 * The sections of the site, in nav order. Adding a section is one line here
 * (plus its page and build); every page's nav picks it up.
 */
export const SECTIONS = [
  { id: 'renderers', href: 'renderers/' },
  { id: 'players', href: 'players/' },
];

/**
 * Fills in `<nav class="subnav" data-page="…" data-root="…">`: one plain link per section,
 * the current one white. `data-root` is the path back to the site root from this page.
 */
export function mountNav() {
  const nav = document.querySelector<HTMLElement>('nav.subnav');
  if (!nav) return;
  const root = nav.dataset.root ?? '';
  const parts: Node[] = [];
  SECTIONS.forEach((s, i) => {
    if (i) parts.push(document.createTextNode(' · '));
    const a = document.createElement('a');
    a.href = root + s.href;
    a.textContent = s.id;
    if (s.id === nav.dataset.page) {
      a.classList.add('on');
      a.setAttribute('aria-current', 'page');
    }
    parts.push(a);
  });
  nav.replaceChildren(...parts);
}
