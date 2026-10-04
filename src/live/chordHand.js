// Main gauche : les accords, toujours actifs.
// Pose stable -> degré ; dos de la main -> mineur/majeur parallèle ; doigts vers le bas -> un demi-ton plus bas ;
// hauteur -> épices (revoicing en direct) ; rotation -> filtre et longueur des notes.

import { GestureStabilizer } from '../core/trigger.js';
import { POSE_DEGREE, buildChord, chordName, romanName, spiceBand, voice } from './theory.js';

export class ChordHand {
  constructor(audio) {
    this.audio = audio;
    this.stab = new GestureStabilizer({ enterFrames: 3, exitFrames: 4, holdMs: 1e9 });
    this.snap = true; // caler l'attaque sur la croche suivante
    this.spread = 0; // réglé par le mode sculpt
    this.band = null;
    this.chord = null;
    this.notes = [];
  }

  /** Clé de pose : « degré|parallèle|bémol », ou « none ». */
  static poseKey(hand) {
    if (!hand) return 'none';
    const degree = POSE_DEGREE[hand.label];
    if (degree === undefined) return 'none';
    return `${degree}|${hand.palmFacing ? 0 : 1}|${hand.pointsDown ? 1 : 0}`;
  }

  /**
   * @param {object|null} hand main gauche
   * @param {{root:number, mode:string}} key
   * @param {number} height hauteur normalisée 0..1
   * @returns {object|null} état affichable
   */
  update(hand, key, height, t) {
    const events = this.stab.update(ChordHand.poseKey(hand), t);
    const current = this.stab.current;
    if (hand) this.audio.setPadTone(hand.roll);

    if (current === 'none') {
      if (this.chord) {
        this.audio.releaseChord();
        this.chord = null;
        this.notes = [];
        this.band = null;
      }
      return null;
    }
    const [degree, flip, flat] = current.split('|').map(Number);
    if (hand) this.band = spiceBand(height, this.band);
    const chord = buildChord(key, degree, { flip: flip === 1, flat: flat === 1, spice: this.band ?? 0 });
    const notes = voice(chord, { spread: this.spread });
    const newPose = events.some((e) => e.type === 'enter');
    const changed = notes.join() !== this.notes.join();
    if (newPose || changed) {
      const time = newPose && this.snap && this.audio.ready ? this.audio.nextEighth() : undefined;
      this.audio.setChord(notes, time);
      this.chord = chord;
      this.notes = notes;
    }
    return this.state();
  }

  state() {
    if (!this.chord) return null;
    return {
      name: chordName(this.chord),
      roman: romanName(this.chord),
      spice: this.chord.spice,
      flip: this.chord.flip,
      flat: this.chord.flat,
      notes: this.notes,
      chord: this.chord,
    };
  }
}
