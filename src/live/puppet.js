// Main « marionnette » dessinée en 2D pour le tutoriel animé.
// Une pose = { curl:[5] (0 = tendu, 1 = replié ; pouce..auriculaire), spread 0..1, rot (degrés),
//              back (dos vers la caméra), pinch: {finger 0..3, amount 0..1} | null }

const LONG = [
  { base: [-0.36, -0.9], len: [0.42, 0.26, 0.22], angle: -8, spreadAngle: -12 },
  { base: [-0.12, -0.97], len: [0.46, 0.29, 0.23], angle: -2, spreadAngle: -3 },
  { base: [0.12, -0.93], len: [0.43, 0.27, 0.22], angle: 4, spreadAngle: 5 },
  { base: [0.34, -0.82], len: [0.33, 0.21, 0.19], angle: 10, spreadAngle: 16 },
];
const THUMB = { base: [-0.32, -0.28], len: [0.3, 0.25, 0.22], angle: -52 };

export const POSES = {
  fist: { curl: [1, 1, 1, 1, 1], spread: 0 },
  open: { curl: [0, 0, 0, 0, 0], spread: 1 },
  palm: { curl: [0, 0, 0, 0, 0], spread: 0 },
  one: { curl: [1, 0, 1, 1, 1], spread: 0.3 },
  two: { curl: [1, 0, 0, 1, 1], spread: 0.5 },
  three: { curl: [1, 0, 0, 0, 1], spread: 0.4 },
  four: { curl: [1, 0, 0, 0, 0], spread: 0.4 },
  horns: { curl: [1, 0, 1, 1, 0], spread: 0.6 },
  hornsThumb: { curl: [0, 0, 1, 1, 0], spread: 0.6 },
  like: { curl: [0, 1, 1, 1, 1], spread: 0, rot: -90 },
  pinchIndex: { curl: [0, 0.25, 0, 0, 0], spread: 0.5, pinch: { finger: 0, amount: 1 } },
};

const rad = (d) => (d * Math.PI) / 180;
const lerp = (a, b, t) => a + (b - a) * t;

/** Points 2D (repère local, poignet en 0,0, y vers le haut négatif) de toute la main. */
export function puppetPoints(pose) {
  const curl = pose.curl ?? [0, 0, 0, 0, 0];
  const spread = pose.spread ?? 0;
  const pinch = pose.pinch ?? null;
  const fingers = LONG.map((f, i) => {
    let c = curl[i + 1];
    if (pinch && pinch.finger === i) c = Math.max(c, 0.3 * pinch.amount);
    const a = rad(f.angle + spread * f.spreadAngle);
    const up = { x: Math.sin(a), y: -Math.cos(a) };
    // Raccourcissement : un doigt qui se replie vers la caméra paraît plus court puis redescend sur la paume.
    const k = [1 - 0.85 * c, 1 - 2 * c, 1 - 2.6 * c];
    const pts = [{ x: f.base[0], y: f.base[1] }];
    for (let s = 0; s < 3; s++) {
      const p = pts[pts.length - 1];
      pts.push({ x: p.x + up.x * f.len[s] * k[s], y: p.y + up.y * f.len[s] * k[s] });
    }
    return pts;
  });

  // Pouce : il pivote vers la paume quand il se replie.
  const c0 = curl[0];
  const ta = rad(THUMB.angle + c0 * 85);
  const tdir = { x: Math.sin(ta), y: -Math.cos(ta) };
  const thumb = [{ x: THUMB.base[0], y: THUMB.base[1] }];
  for (let s = 0; s < 3; s++) {
    const p = thumb[thumb.length - 1];
    const l = THUMB.len[s] * (1 - 0.3 * c0);
    const bend = rad(s * 18 * c0);
    const d = { x: tdir.x * Math.cos(bend) - tdir.y * Math.sin(bend), y: tdir.x * Math.sin(bend) + tdir.y * Math.cos(bend) };
    thumb.push({ x: p.x + d.x * l, y: p.y + d.y * l });
  }
  if (pinch) {
    const tip = fingers[pinch.finger][3];
    const t = thumb[3];
    const dx = (tip.x - t.x) * pinch.amount;
    const dy = (tip.y - t.y) * pinch.amount;
    for (let j = 1; j <= 3; j++) {
      thumb[j] = { x: thumb[j].x + (dx * j) / 3, y: thumb[j].y + (dy * j) / 3 };
    }
  }
  return { thumb, fingers };
}

/** Interpolation entre deux poses (t de 0 à 1). */
export function blendPose(a, b, t) {
  const ca = a.curl ?? [0, 0, 0, 0, 0];
  const cb = b.curl ?? [0, 0, 0, 0, 0];
  const pa = a.pinch ?? (b.pinch ? { finger: b.pinch.finger, amount: 0 } : null);
  const pb = b.pinch ?? (a.pinch ? { finger: a.pinch.finger, amount: 0 } : null);
  return {
    curl: ca.map((v, i) => lerp(v, cb[i], t)),
    spread: lerp(a.spread ?? 0, b.spread ?? 0, t),
    rot: lerp(a.rot ?? 0, b.rot ?? 0, t),
    back: t < 0.5 ? !!a.back : !!b.back,
    pinch: pa && pb ? { finger: pb.finger, amount: lerp(pa.amount, pb.amount, t) } : null,
  };
}

/**
 * Dessine la main.
 * @param {'left'|'right'} side main du joueur (vue en miroir : le pouce de la main droite est à gauche)
 */
export function drawPuppet(ctx, x, y, size, pose, side = 'right', { ink = '236, 233, 226', accent = '#f4c26b' } = {}) {
  const { thumb, fingers } = puppetPoints(pose);
  // Main gauche = symétrique ; dos de la main = encore symétrique (le pouce change de côté).
  const flip = (side === 'left') !== !!pose.back ? -1 : 1;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rad(pose.rot ?? 0) * (side === 'left' ? -1 : 1));
  ctx.scale(size * flip, size);
  const px = 1 / size;

  // Paume.
  const palm = [
    { x: -0.3, y: 0 },
    thumb[0],
    fingers[0][0],
    fingers[1][0],
    fingers[2][0],
    fingers[3][0],
    { x: 0.3, y: -0.05 },
  ];
  ctx.beginPath();
  palm.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.fillStyle = `rgba(${ink}, ${pose.back ? 0.16 : 0.06})`;
  ctx.fill();
  ctx.lineWidth = 1.5 * px;
  ctx.strokeStyle = `rgba(${ink}, 0.7)`;
  ctx.stroke();
  if (pose.back) {
    // Dos de la main : petites lignes de jointures.
    ctx.strokeStyle = `rgba(${ink}, 0.35)`;
    for (const f of fingers) {
      ctx.beginPath();
      ctx.moveTo(f[0].x - 0.05, f[0].y + 0.08);
      ctx.lineTo(f[0].x + 0.05, f[0].y + 0.08);
      ctx.stroke();
    }
  }

  // Doigts : trait épais translucide (la chair) puis squelette fin.
  for (const chain of [thumb, ...fingers]) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = `rgba(${ink}, 0.13)`;
    ctx.lineWidth = 0.15;
    ctx.beginPath();
    chain.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
    ctx.strokeStyle = `rgba(${ink}, 0.9)`;
    ctx.lineWidth = 1.5 * px;
    ctx.stroke();
    ctx.fillStyle = `rgba(${ink}, 0.95)`;
    for (const p of chain) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.5 * px, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (pose.pinch && pose.pinch.amount > 0.8) {
    const tip = fingers[pose.pinch.finger][3];
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2 * px;
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, 0.12, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}
