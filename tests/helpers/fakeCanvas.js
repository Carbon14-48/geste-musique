// Faux canvas 2D pour tester le dessin sans navigateur : accepte n'importe quel appel
// ou affectation sans erreur (il n'y a pas de DOM dans les tests Vitest en environnement node).

export function fakeCtx() {
  const special = {
    measureText: () => ({ width: 40 }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
  };
  return new Proxy(special, {
    get: (t, prop) => (prop in t ? t[prop] : () => {}),
    set: () => true,
  });
}

export function fakeCanvas(width = 960, height = 540) {
  const ctx = fakeCtx();
  return {
    width: 0,
    height: 0,
    getBoundingClientRect: () => ({ width, height }),
    getContext: () => ctx,
  };
}
