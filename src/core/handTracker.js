// Transforme les résultats bruts de MediaPipe en états de main exploitables par les modes :
// rôle (gauche/droite), points lissés, pose stable, comptage, mouvements, valeurs continues.

import { LM, dist, dist2d, normalizePose } from './landmarks.js';
import { LandmarkSmoother } from './oneEuro.js';
import { classifyPose, openness, palmFacingCamera, handPointsDown, DEFAULT_THRESHOLDS } from './rules.js';
import { GestureStabilizer, Cooldown } from './trigger.js';
import { MotionTracker } from './motion.js';

const SMOOTHING = { minCutoff: 1.5, beta: 0.05, dCutoff: 1.0 };

function makeSlot() {
  return {
    imageSmoother: new LandmarkSmoother(SMOOTHING),
    worldSmoother: new LandmarkSmoother(SMOOTHING),
    pose: new GestureStabilizer({ enterFrames: 4, exitFrames: 4, holdMs: 500 }),
    count: new GestureStabilizer({ enterFrames: 3, exitFrames: 3, holdMs: 400, idle: '-' }),
    motion: new MotionTracker(),
    buffer: [], // fenêtre [{t, hand}] pour le modèle dynamique
    lostFrames: 0,
    state: null,
  };
}

export class HandTracker {
  constructor() {
    this.mirror = true; // affichage « miroir » : la main droite apparaît à droite
    this.swapHands = false;
    this.invertPalm = false; // réglage si la détection paume / dos est inversée sur une caméra
    this.thresholds = { ...DEFAULT_THRESHOLDS };
    this.poseModel = null; // classifieur TF.js optionnel {predict(features) -> {label, confidence}}
    this.poseModelMinConfidence = 0.8;
    this.slots = { left: makeSlot(), right: makeSlot() };
    this.clapCd = new Cooldown(250);
    this.prevHandsDist = null;
  }

  roleFromLabel(label) {
    // MediaPipe suppose une image « selfie » (miroir). Sur l'image brute de la webcam,
    // « Left » correspond donc à la vraie main droite du musicien.
    const role = label === 'Left' ? 'right' : 'left';
    if (!this.swapHands) return role;
    return role === 'left' ? 'right' : 'left';
  }

  /**
   * @param {object} result HandLandmarkerResult
   * @param {number} t temps en ms
   * @returns {{t:number, hands:{left:object|null,right:object|null}, events:object[], twoHands:object|null}}
   */
  update(result, t) {
    const detections = (result?.landmarks ?? []).map((image, i) => ({
      image,
      world: result.worldLandmarks?.[i] ?? image,
      handedness: (result.handedness ?? result.handednesses)?.[i]?.[0]?.categoryName ?? 'Right',
      score: (result.handedness ?? result.handednesses)?.[i]?.[0]?.score ?? 1,
    }));

    // Attribution des rôles, avec repli sur la position à l'écran si les deux mains ont la même étiquette.
    let assigned = detections.map((d) => ({ ...d, role: this.roleFromLabel(d.handedness) }));
    if (assigned.length === 2 && assigned[0].role === assigned[1].role) {
      const sx = (d) => (this.mirror ? 1 - d.image[0].x : d.image[0].x);
      assigned.sort((a, b) => sx(a) - sx(b));
      assigned[0].role = 'left';
      assigned[1].role = 'right';
    }
    assigned = assigned.slice(0, 2);

    const events = [];
    const hands = { left: null, right: null };
    const ts = t / 1000;

    for (const role of ['left', 'right']) {
      const slot = this.slots[role];
      const det = assigned.find((d) => d.role === role);
      if (!det) {
        slot.lostFrames++;
        if (slot.lostFrames > 3 && slot.state) {
          // Main perdue : on relâche proprement la pose en cours.
          for (const e of slot.pose.update('none', t)) events.push({ ...e, type: `pose_${e.type}`, hand: role });
          for (const e of slot.count.update('-', t)) events.push({ type: `count_${e.type}`, count: +e.label, hand: role, t });
          if (slot.lostFrames > 10) {
            slot.imageSmoother.reset();
            slot.worldSmoother.reset();
            slot.motion.reset();
            slot.state = null;
          }
        }
        slot.buffer.push({ t, hand: null });
        this.trimBuffer(slot, t);
        continue;
      }
      slot.lostFrames = 0;
      const image = slot.imageSmoother.smooth(det.image, ts);
      const world = slot.worldSmoother.smooth(det.world, ts);
      const state = this.buildState(role, det.handedness, image, world, t);
      slot.state = state;
      hands[role] = state;

      for (const e of slot.pose.update(state.rawLabel, t)) events.push({ ...e, type: `pose_${e.type}`, hand: role });
      for (const e of slot.count.update(String(state.rawCount), t)) {
        events.push({ type: `count_${e.type}`, count: +e.label, hand: role, t });
      }
      state.label = slot.pose.current;
      state.count = slot.count.current === '-' ? null : +slot.count.current;

      for (const e of slot.motion.update(t, state.palm, state.screen[LM.INDEX_TIP].y, state.size)) {
        events.push({ ...e, hand: role, t });
      }
      state.velocity = { ...slot.motion.velocity };

      slot.buffer.push({ t, hand: { image: det.image, world: det.world, handedness: det.handedness } });
      this.trimBuffer(slot, t);
    }

    // Deux mains : distance et applaudissement.
    let twoHands = null;
    if (hands.left && hands.right) {
      const size = (hands.left.size + hands.right.size) / 2;
      const d = dist2d(hands.left.palm, hands.right.palm) / Math.max(size, 1e-3);
      const closing = this.prevHandsDist !== null ? this.prevHandsDist - d : 0;
      if (d < 1.2 && closing > 0.4 && this.clapCd.ready(t)) events.push({ type: 'clap', hand: 'both', t, speed: closing });
      this.prevHandsDist = d;
      twoHands = { distance: d, screenDistance: dist2d(hands.left.palm, hands.right.palm) };
    } else {
      this.prevHandsDist = null;
    }
    return { t, hands, events, twoHands };
  }

  trimBuffer(slot, t) {
    while (slot.buffer.length && t - slot.buffer[0].t > 1500) slot.buffer.shift();
  }

  buildState(role, handedness, image, world, t) {
    const screen = image.map((p) => ({ x: this.mirror ? 1 - p.x : p.x, y: p.y, z: p.z ?? 0 }));
    const palmIdx = [LM.WRIST, LM.INDEX_MCP, LM.MIDDLE_MCP, LM.RING_MCP, LM.PINKY_MCP];
    const palm = {
      x: palmIdx.reduce((s, i) => s + screen[i].x, 0) / palmIdx.length,
      y: palmIdx.reduce((s, i) => s + screen[i].y, 0) / palmIdx.length,
    };
    const size = dist2d(image[LM.WRIST], image[LM.MIDDLE_MCP]);
    const pose = classifyPose(world, image, this.thresholds);
    let rawLabel = pose.label;
    let modelLabel = null;
    const features = normalizePose(world, handedness);
    if (this.poseModel) {
      const pred = this.poseModel.predict(features);
      if (pred && pred.confidence >= this.poseModelMinConfidence) {
        modelLabel = pred;
        rawLabel = pred.label;
      }
    }
    // Angle de la ligne poignet -> base du majeur par rapport à la verticale (degrés, écran).
    const w = screen[LM.WRIST];
    const m = screen[LM.MIDDLE_MCP];
    const tilt = (Math.atan2(m.x - w.x, w.y - m.y) * 180) / Math.PI;
    // Distance bout du pouce -> bout de chaque doigt (index..auriculaire), en tailles de main.
    const wsize = Math.max(dist(world[LM.WRIST], world[LM.MIDDLE_MCP]), 1e-6);
    const pinches = [LM.INDEX_TIP, LM.MIDDLE_TIP, LM.RING_TIP, LM.PINKY_TIP].map(
      (tip) => dist(world[LM.THUMB_TIP], world[tip]) / wsize,
    );
    return {
      role,
      handedness,
      t,
      image,
      world,
      screen,
      palm,
      size,
      features,
      rawLabel,
      rulesLabel: pose.label,
      modelLabel,
      rawCount: pose.count,
      fingers: pose.fingers,
      fingerStates: pose.states,
      bends: pose.bends,
      pinch: pose.pinch,
      spread: pose.spread,
      openness: openness(world),
      height: 1 - palm.y,
      depth: size, // plus la main est grande à l'écran, plus elle est proche
      tilt,
      // Rotation du poignet ramenée dans [0, 1] (-50° -> 0, 0° -> 0,5, +50° -> 1).
      roll: Math.max(0, Math.min(1, 0.5 + tilt / 100)),
      pinches,
      pointsDown: handPointsDown(image),
      palmFacing: palmFacingCamera(image, handedness) !== this.invertPalm,
      label: 'none',
      count: null,
      velocity: { x: 0, y: 0, speed: 0 },
    };
  }

  /** Fenêtre récente d'une main pour le modèle dynamique. */
  window(role) {
    return this.slots[role].buffer;
  }
}
