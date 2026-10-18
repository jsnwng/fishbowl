import { buildFisherman } from './art';
import type { HunterEntry } from './hunters';

/**
 * Pick who fishes, like a game's player-select screen: one fisherman per hunter, in that
 * hunter's raincoat. Underneath it's a radio group, so arrow keys, focus and screen readers
 * behave like any other form control. The first hunter starts selected.
 */
export function mountHunterPicker(container: HTMLElement, hunters: HunterEntry[], onPick: (entry: HunterEntry) => void) {
  container.classList.add('picker');
  container.setAttribute('role', 'radiogroup');
  hunters.forEach((h, i) => {
    const label = document.createElement('label');
    label.className = 'pick';

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'hunter';
    input.value = h.id;
    input.checked = i === 0;
    input.addEventListener('change', () => input.checked && onPick(h));

    const sprite = buildFisherman(h.coat);
    sprite.className = 'pick-sprite';
    sprite.setAttribute('aria-hidden', 'true');

    const name = document.createElement('span');
    name.className = 'pick-name';
    name.textContent = h.id;

    label.append(input, sprite, name);
    container.appendChild(label);
  });
}

/** The info panel: what the picked hunter does, keyed by its coat color. */
export function describeHunter(panel: HTMLElement, picked: HunterEntry) {
  const p = document.createElement('p');
  const key = document.createElement('span');
  key.className = 'key';
  key.style.background = picked.coat.main;
  const name = document.createElement('b');
  name.textContent = picked.id;
  p.append(key, name, ` ${picked.blurb}`);
  panel.replaceChildren(p);
}
