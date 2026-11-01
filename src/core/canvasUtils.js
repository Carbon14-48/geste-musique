// Petits utilitaires canvas partagés par plate.js (Geste Live) et overlay.js (Studio).

/** Trace un rectangle arrondi (repli sur un rectangle droit si roundRect n'est pas supporté). */
export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}
