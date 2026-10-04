// Main droite : les 5 modes de l'arc. Un pincement choisit une piste (un doigt = une piste),
// la rotation du poignet règle sa valeur, et la valeur reste quand on lâche (sauf fx, momentané).

import { DRUM_FAMILIES, DRUM_LEVEL_NAMES, BASS_PARAMS } from './patterns.js';
import { SCALE_STEPS, NOTES_FR } from './theory.js';

export const MELODY_LANES = 12;
const LANE_OFFSETS = [-12, 0, 0, 12]; // chaque doigt a sa propre hauteur d'échelle

/** Note MIDI d'un couloir de mélodie (dans la gamme de la tonalité). */
export function laneNote(key, lane, finger = 1) {
  const steps = SCALE_STEPS[key.mode];
  const n = steps.length;
  return 60 + key.root + LANE_OFFSETS[finger] + 12 * Math.floor(lane / n) + steps[lane % n];
}

export function laneLabel(key, lane) {
  const midi = laneNote(key, lane, 1);
  return NOTES_FR[midi % 12];
}

export function createModes(audio, chordHand) {
  return {
    drums: {
      title: 'batterie',
      tracks: ['grosse caisse', 'caisse claire', 'charleston', 'toms'],
      levels: [0, 0, 0, 0],
      hold(f, hand) {
        this.levels[f] = Math.round(hand.roll * 4);
        audio.drumLevels[f] = this.levels[f];
      },
      release() {},
      idle(hand) {
        audio.setDrumCutoff(hand.roll);
      },
      readout(f) {
        return f === null ? '' : `${this.tracks[f]} · ${DRUM_LEVEL_NAMES[this.levels[f]]}`;
      },
      families: DRUM_FAMILIES,
    },
    bass: {
      title: 'basse',
      tracks: BASS_PARAMS,
      values: [0, 0, 0, 0],
      hold(f, hand) {
        this.values[f] = hand.roll;
        const [density, tones, octave, feel] = this.values;
        audio.bassParams = { density, tones, octave, feel };
      },
      release() {},
      idle(hand, height) {
        audio.setBassResonance(height);
      },
      readout(f) {
        return f === null ? '' : `${this.tracks[f]} · ${Math.round(this.values[f] * 100)} %`;
      },
    },
    melody: {
      title: 'mélodie',
      tracks: ['saw', 'square', 'flûte', 'verre'],
      lanes: [null, null, null, null],
      key: null,
      hold(f, hand, height) {
        const lane = Math.max(0, Math.min(MELODY_LANES - 1, Math.floor(height * MELODY_LANES)));
        this.lanes[f] = lane;
        audio.leadOn(f, laneNote(this.key, lane, f));
        audio.setLeadFilter(hand.roll);
      },
      release(f) {
        this.lanes[f] = null;
        audio.leadOff(f);
      },
      idle(hand) {
        audio.setLeadFilter(hand.roll);
      },
      readout(f) {
        return f === null || this.lanes[f] === null ? '' : `${this.tracks[f]} · ${laneLabel(this.key, this.lanes[f])}`;
      },
    },
    fx: {
      title: 'fx / dj',
      tracks: ['delay', 'réverb', 'stutter', 'crush'],
      amounts: [0, 0, 0, 0],
      active: [false, false, false, false],
      hold(f, hand) {
        this.active[f] = true;
        this.amounts[f] = hand.roll;
        audio.setFx(f, hand.roll, true);
      },
      release(f) {
        this.active[f] = false;
        audio.setFx(f, 0, false);
      },
      idle() {},
      readout(f) {
        return f === null ? '' : `${this.tracks[f]} · ${Math.round(this.amounts[f] * 100)} %`;
      },
    },
    sculpt: {
      title: 'sculpt',
      tracks: ['arpège', 'enveloppe', 'trémolo', 'grain'],
      values: [0, 0, 0, 0],
      spread: 0,
      hold(f, hand) {
        this.values[f] = hand.roll < 0.08 ? 0 : hand.roll;
        const v = this.values[f];
        if (f === 0) audio.setArp(v);
        else if (f === 1) audio.setEnvelope(v);
        else if (f === 2) audio.setTremolo(v);
        else audio.setGrit(v);
      },
      release() {},
      idle(hand, height) {
        // Hauteur de la main = largeur du voicing des accords.
        this.spread = height;
        chordHand.spread = height;
      },
      readout(f) {
        return f === null ? `ouverture · ${Math.round(this.spread * 100)} %` : `${this.tracks[f]} · ${Math.round(this.values[f] * 100)} %`;
      },
    },
  };
}
