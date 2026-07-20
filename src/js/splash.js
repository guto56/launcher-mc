// splash.js — controla o overlay de entrada (#splash).
// Faz fade/scale-out após o boot (quando o app sinaliza pronto).

let done = false;

/**
 * Esconde o splash com animação splash-out.
 * Chame após o boot (home ou wizard prontos).
 */
export function hideSplash() {
  if (done) return;
  done = true;
  const splash = document.getElementById('splash');
  if (!splash) return;

  // Respeita prefers-reduced-motion: some imediatamente.
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) {
    splash.style.display = 'none';
    return;
  }

  splash.classList.add('hide');
  // Remove do DOM após a animação (0.55s).
  setTimeout(() => {
    splash.style.display = 'none';
  }, 600);
}

/**
 * Mostra o splash (caso precise reexibir).
 */
export function showSplash() {
  done = false;
  const splash = document.getElementById('splash');
  if (splash) {
    splash.style.display = 'flex';
    splash.classList.remove('hide');
  }
}
