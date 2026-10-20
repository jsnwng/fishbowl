import type { HunterEntry } from '../game/hunters';
import type { Said } from './director';

const MAX_MESSAGES = 80;

/** The stream's DOM: the streamer's speech bubble over the bowl, and the chat beside it. */
export class StreamUI {
  private hideAt = 0;
  private timer = 0;

  constructor(
    private bubble: HTMLElement,
    private tail: HTMLElement,
    private log: HTMLElement,
    private viewersEl: HTMLElement,
    private hunters: HunterEntry[],
  ) {}

  say(s: Said) {
    if (s.role === 'streamer') this.showBubble(s.text);
    else this.post(s.speaker, s.text);
  }

  setViewers(n: number) {
    this.viewersEl.textContent = `${n} watching`;
  }

  /** A line from the page itself, dimmed, like a stream's system messages. */
  notice(text: string) {
    const p = document.createElement('p');
    p.className = 'msg notice';
    p.textContent = text;
    this.append(p);
  }

  clearBubble() {
    this.bubble.hidden = this.tail.hidden = true;
    clearTimeout(this.timer);
  }

  private showBubble(text: string) {
    this.bubble.textContent = text;
    this.bubble.hidden = this.tail.hidden = false;
    // long enough to read: about a third of a second a word, 2.5s at least
    const ms = Math.max(2500, text.split(/\s+/).length * 330 + 800);
    this.hideAt = performance.now() + ms;
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      if (performance.now() >= this.hideAt) this.bubble.hidden = this.tail.hidden = true;
    }, ms);
  }

  private post(speaker: string, text: string) {
    const p = document.createElement('p');
    p.className = 'msg';
    const name = document.createElement('b');
    name.textContent = speaker;
    name.style.color = this.hunters.find((h) => h.id === speaker)?.coat.main ?? 'inherit';
    p.append(name, ` ${text}`);
    this.append(p);
  }

  private append(p: HTMLElement) {
    // only follow new messages if the reader is already at the bottom
    const atBottom = this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 24;
    this.log.appendChild(p);
    while (this.log.children.length > MAX_MESSAGES) this.log.firstElementChild?.remove();
    if (atBottom) this.log.scrollTop = this.log.scrollHeight;
  }
}
