/**
 * The parts of the site, in order. Adding a part is one line here
 * (plus its page and build); every page's nav picks it up. A part without
 * an href isn't built yet: it shows faint, as a promise, not a link.
 */
export const SECTIONS: { id: string; part: number; href?: string }[] = [
  { id: 'renderers', part: 1, href: 'renderers/' },
  { id: 'players', part: 2, href: 'players/' },
  { id: 'chatter', part: 3, href: 'chatter/' },
  { id: 'battle', part: 4, href: 'battle/' },
];

/**
 * Fills in `<nav class="subnav" data-page="…" data-root="…">`: one boxed tab per part,
 * the current one filled. `data-root` is the path back to the site root from this page.
 */
export function mountNav() {
  const nav = document.querySelector<HTMLElement>('nav.subnav');
  if (!nav) return;
  const root = nav.dataset.root ?? '';
  nav.replaceChildren(
    ...SECTIONS.map((s) => {
      const tab = document.createElement(s.href ? 'a' : 'span');
      tab.className = 'tab';
      tab.textContent = `pt.${s.part} ${s.id}`;
      if (!s.href) {
        tab.classList.add('soon');
        tab.title = 'coming eventually';
      } else {
        (tab as HTMLAnchorElement).href = root + s.href;
        if (s.id === nav.dataset.page) {
          tab.classList.add('on');
          tab.setAttribute('aria-current', 'page');
        }
      }
      return tab;
    }),
  );
}
