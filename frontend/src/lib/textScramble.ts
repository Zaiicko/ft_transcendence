// Matrix-style scramble/decode effect (left→right), with a stable layout (spaces/newlines never scramble) and escaped scrambling chars since the text comes from the API.

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#%&*+=-';
// Spread the resolve times over ~50 frames so total duration stays bounded (~1.3s).
const SPREAD = 50;

const escapeChar = (c: string) =>
  c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c;

const randomChar = () => CHARS[Math.floor(Math.random() * CHARS.length)];

export function scrambleText(el: HTMLElement, text: string): () => void {
  const length = text.length;
  const queue = Array.from({ length }, (_, i) => ({
    to: text[i],
    space: /\s/.test(text[i]),
    end: Math.floor((i / length) * SPREAD) + 14 + Math.floor(Math.random() * 16),
    char: '',
  }));

  let frame = 0;
  let raf = 0;
  const update = () => {
    let output = '';
    let complete = 0;
    for (const q of queue) {
      if (q.space || frame >= q.end) {
        complete++;
        output += escapeChar(q.to);
      } else {
        if (!q.char || Math.random() < 0.3) q.char = randomChar();
        output += `<span style="opacity:.5">${escapeChar(q.char)}</span>`;
      }
    }
    el.innerHTML = output;
    if (complete === queue.length) {
      el.textContent = text; // clean final state (removes the <span>s)
      return;
    }
    frame++;
    raf = requestAnimationFrame(update);
  };
  // First frame is synchronous (from useLayoutEffect) → no flash of the final text.
  update();
  return () => cancelAnimationFrame(raf);
}
