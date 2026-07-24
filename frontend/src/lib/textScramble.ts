// Effet "scramble/décodage" façon Matrix : chaque lettre défile sur des symboles
// aléatoires puis se fige sur la bonne, en progression gauche→droite.
//
// Layout STABLE : l'effet est calé sur le texte FINAL, et les espaces / retours
// à la ligne ne défilent jamais. Chaque mot garde donc la longueur exacte du mot
// final pendant toute l'animation → le retour à la ligne est identique du début
// à la fin (5 lignes restent 5 lignes, 40 mots restent 40 mots), aucun reflow.
//
// Sécurité : le texte vient de l'API (résumé IGDB) et est injecté via innerHTML
// pour styliser les caractères en défilement → on échappe < > & ; l'état final
// utilise textContent (auto-échappé).

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#%&*+=-';
// Étalement des instants de résolution sur ~50 frames quel que soit la longueur
// → durée totale bornée (~1,3 s) même pour un long paragraphe.
const SPREAD = 50;

const escapeChar = (c: string) =>
  c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c;

const randomChar = () => CHARS[Math.floor(Math.random() * CHARS.length)];

export function scrambleText(el: HTMLElement, text: string): () => void {
  const length = text.length;
  const queue = Array.from({ length }, (_, i) => ({
    to: text[i],
    // Espace / tab / retour à la ligne : jamais scramblé (fige le layout).
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
      el.textContent = text; // état final propre (retire les <span>)
      return;
    }
    frame++;
    raf = requestAnimationFrame(update);
  };
  // 1re frame synchrone : appelé depuis un useLayoutEffect → pose l'état de
  // départ avant le paint, pas de flash du texte final.
  update();
  return () => cancelAnimationFrame(raf);
}
