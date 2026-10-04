// Enregistrement d'exemples (poses et séquences) pour l'entraînement Python.
// On stocke les points bruts (pas les caractéristiques) : la normalisation est refaite
// par training/common.py, ce qui permet de la faire évoluer sans réenregistrer.

const round = (v) => Math.round(v * 1e5) / 1e5;
const pack = (pts) => pts.map((p) => [round(p.x), round(p.y), round(p.z ?? 0)]);

export class DatasetRecorder {
  constructor() {
    this.subject = 'joueur1';
    this.poses = [];
    this.sequences = [];
  }

  addPose(label, hand) {
    this.poses.push({
      label,
      subject: this.subject,
      handedness: hand.handedness,
      world: pack(hand.world),
      image: pack(hand.image),
    });
  }

  /** @param {{t:number, hand:object|null}[]} frames */
  addSequence(label, frames) {
    const t0 = frames[0]?.t ?? 0;
    this.sequences.push({
      label,
      subject: this.subject,
      frames: frames.map((f) => ({
        t: Math.round(f.t - t0),
        hand: f.hand ? { handedness: f.hand.handedness, world: pack(f.hand.world), image: pack(f.hand.image) } : null,
      })),
    });
  }

  stats() {
    const count = (arr) => arr.reduce((acc, s) => ({ ...acc, [s.label]: (acc[s.label] ?? 0) + 1 }), {});
    return { poses: count(this.poses), sequences: count(this.sequences) };
  }

  clear() {
    this.poses = [];
    this.sequences = [];
  }

  toJSON() {
    return { format: 'geste-musique-dataset', version: 1, poses: this.poses, sequences: this.sequences };
  }

  load(data) {
    if (data?.format !== 'geste-musique-dataset') throw new Error('Fichier de données non reconnu');
    this.poses.push(...(data.poses ?? []));
    this.sequences.push(...(data.sequences ?? []));
  }
}
