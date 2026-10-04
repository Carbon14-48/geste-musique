// Main synthétique pour les tests : on choisit l'état de chaque doigt et on obtient
// 21 points « monde » (mètres, y vers le bas comme l'image) et 21 points « image » (0..1).

const MCP = {
  1: { x: -0.025, y: -0.02 }, // CMC du pouce
  5: { x: -0.02, y: -0.085 },
  9: { x: 0, y: -0.088 },
  13: { x: 0.02, y: -0.083 },
  17: { x: 0.038, y: -0.075 },
};
const LENGTHS = [0.04, 0.025, 0.022];

const add = (p, d, k) => ({ x: p.x + d.x * k, y: p.y + d.y * k, z: (p.z ?? 0) + (d.z ?? 0) * k });
const unit = (v) => {
  const n = Math.hypot(v.x, v.y, v.z ?? 0);
  return { x: v.x / n, y: v.y / n, z: (v.z ?? 0) / n };
};

function longFinger(base, state, tiltDeg = 0) {
  const a = (tiltDeg * Math.PI) / 180;
  const up = { x: Math.sin(a), y: -Math.cos(a), z: 0 };
  const mcp = { ...base, z: 0 };
  let dirs;
  if (state === 'up') dirs = [up, up, up];
  else if (state === 'half') dirs = [up, unit({ x: up.x * 0.5, y: -0.5, z: 0.87 }), unit({ x: 0, y: 0.15, z: 1 })];
  else dirs = [{ x: 0, y: 0, z: 1 }, { x: 0, y: 1, z: 0 }, unit({ x: 0, y: 0.3, z: -1 })];
  const pip = add(mcp, dirs[0], LENGTHS[0]);
  const dip = add(pip, dirs[1], LENGTHS[1]);
  const tip = add(dip, dirs[2], LENGTHS[2]);
  return [mcp, pip, dip, tip];
}

function thumb(state) {
  const cmc = { ...MCP[1], z: 0 };
  const mcp = { x: -0.045, y: -0.04, z: 0 };
  if (state === 'up') {
    const d = unit({ x: -0.8, y: -0.6, z: 0 });
    const ip = add(mcp, d, 0.03);
    return [cmc, mcp, ip, add(ip, d, 0.025)];
  }
  return [cmc, mcp, { x: -0.03, y: -0.06, z: 0.02 }, { x: -0.005, y: -0.06, z: 0.025 }];
}

/**
 * @param {string[]} states 5 états : 'up' | 'half' | 'down' (pouce, index, majeur, annulaire, auriculaire)
 * @param {{tilts?:number[], rotateDeg?:number, overrides?:Object<number,{x,y,z}>}} options
 */
export function synthHand(states, { tilts = [0, 0, 0, 0, 0], rotateDeg = 0, overrides = {} } = {}) {
  const world = [{ x: 0, y: 0, z: 0 }];
  world.push(...thumb(states[0]));
  [5, 9, 13, 17].forEach((b, i) => world.push(...longFinger(MCP[b], states[i + 1], tilts[i + 1])));
  for (const [k, v] of Object.entries(overrides)) world[+k] = v;
  const a = (rotateDeg * Math.PI) / 180;
  const rotated = world.map((p) => ({
    x: p.x * Math.cos(a) - p.y * Math.sin(a),
    y: p.x * Math.sin(a) + p.y * Math.cos(a),
    z: p.z,
  }));
  const image = rotated.map((p) => ({ x: 0.5 + p.x * 3, y: 0.6 + p.y * 3, z: p.z }));
  return { world: rotated, image };
}

export const U = 'up';
export const D = 'down';
export const H = 'half';
