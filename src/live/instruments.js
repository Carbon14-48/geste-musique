// Instruments enregistrés : échantillons de nbrosowsky/tonejs-instruments
// (https://github.com/nbrosowsky/tonejs-instruments), licence CC BY 3.0 : l'auteur doit être cité.
// Les fichiers sont servis par jsDelivr et mis en cache par le navigateur.

export const SAMPLE_BASE = 'https://cdn.jsdelivr.net/gh/nbrosowsky/tonejs-instruments@master/samples/';
export const SAMPLE_CREDIT = 'Échantillons : nbrosowsky/tonejs-instruments (CC BY 3.0)';

// Notes disponibles par instrument (« s » = dièse, comme dans les noms de fichiers).
const FILES = {
  piano: 'A1 A2 A3 A4 A5 A6 A7 C1 C2 C3 C4 C5 C6 C7 C8 Ds1 Ds2 Ds3 Ds4 Ds5 Ds6 Ds7 Fs1 Fs2 Fs3 Fs4 Fs5 Fs6 Fs7',
  'guitar-acoustic': 'A2 A3 A4 As2 As3 As4 B2 B3 B4 C3 C4 C5 Cs3 Cs4 Cs5 D2 D3 D4 D5 Ds2 Ds3 Ds4 E2 E3 E4 F2 F3 F4 Fs2 Fs3 Fs4 G2 G3 G4 Gs2 Gs3 Gs4',
  'guitar-nylon': 'A2 A3 A4 A5 As5 B1 B2 B3 B4 Cs3 Cs4 Cs5 D2 D3 D5 Ds4 E2 E3 E4 E5 Fs2 Fs3 Fs4 Fs5 G3 G5 Gs2 Gs4 Gs5',
  'guitar-electric': 'A2 A3 A4 A5 C3 C4 C5 C6 Cs2 Ds3 Ds4 Ds5 E2 Fs2 Fs3 Fs4 Fs5',
  violin: 'A3 A4 A5 A6 C4 C5 C6 C7 E4 E5 E6 G3 G4 G5 G6',
  cello: 'A2 A3 A4 As2 As3 B2 B3 B4 C2 C3 C4 C5 Cs3 Cs4 D2 D3 D4 Ds2 Ds3 Ds4 E2 E3 E4 F2 F3 F4 Fs3 Fs4 G2 G3 G4 Gs2 Gs3 Gs4',
  flute: 'A4 A5 A6 C4 C5 C6 C7 E4 E5 E6',
  saxophone: 'A4 A5 As3 As4 B3 B4 C4 C5 Cs3 Cs4 Cs5 D3 D4 D5 Ds3 Ds4 Ds5 E3 E4 E5 F3 F4 F5 Fs3 Fs4 Fs5 G3 G4 G5 Gs3 Gs4 Gs5',
  clarinet: 'As3 As4 As5 D3 D4 D5 D6 F3 F4 F5 Fs6',
  trumpet: 'A3 A5 As4 C4 C6 D5 Ds4 F3 F4 F5 G4',
  harp: 'A2 A4 A6 B1 B3 B5 B6 C3 C5 D2 D4 D6 D7 E1 E3 E5 F2 F4 F6 F7 G1 G3 G5',
  organ: 'A1 A2 A3 A4 A5 C1 C2 C3 C4 C5 C6 Ds1 Ds2 Ds3 Ds4 Ds5 Fs1 Fs2 Fs3 Fs4 Fs5',
  harmonium: 'A2 A3 A4 As2 As3 As4 B2 B3 B4 C2 C3 C4 C5 Cs2 Cs3 Cs4 Cs5 D2 D3 D4 D5 Ds2 Ds3 Ds4 E2 E3 E4 F2 F3 F4 Fs2 Fs3 G2 G3 G4 Gs2 Gs3 Gs4',
  xylophone: 'C5 C6 C7 C8 G4 G5 G6 G7',
};

/** Ordre de la liste (balayage de la main gauche) : `synth` = sons de synthèse (banque choisie dans les réglages). */
export const INSTRUMENTS = [
  { id: 'piano', name: 'piano', release: 1.2 },
  { id: 'guitar-acoustic', name: 'guitare folk', release: 1.5 },
  { id: 'guitar-nylon', name: 'guitare classique', release: 1.5 },
  { id: 'guitar-electric', name: 'guitare électrique', release: 1 },
  { id: 'violin', name: 'violon', release: 0.8 },
  { id: 'cello', name: 'violoncelle', release: 0.8 },
  { id: 'flute', name: 'flûte', release: 0.5 },
  { id: 'saxophone', name: 'saxophone', release: 0.5 },
  { id: 'clarinet', name: 'clarinette', release: 0.5 },
  { id: 'trumpet', name: 'trompette', release: 0.5 },
  { id: 'harp', name: 'harpe', release: 2 },
  { id: 'organ', name: 'orgue', release: 0.4 },
  { id: 'harmonium', name: 'harmonium', release: 0.6 },
  { id: 'xylophone', name: 'xylophone', release: 1.5 },
  { id: 'synth', name: 'synthé', release: 1.5 },
];

export function instrumentInfo(id) {
  return INSTRUMENTS.find((i) => i.id === id) ?? INSTRUMENTS[0];
}

/** « As4 » -> « A#4 » (notation attendue par Tone.Sampler). */
export function fileToNote(file) {
  return file.replace('s', '#');
}

/** Table note -> fichier pour Tone.Sampler, ou null pour le synthé. */
export function sampleUrls(id) {
  const files = FILES[id];
  if (!files) return null;
  const urls = {};
  for (const f of files.split(' ')) urls[fileToNote(f)] = `${f}.mp3`;
  return urls;
}

/** Instrument suivant / précédent dans la liste. */
export function cycleInstrument(id, step) {
  const i = INSTRUMENTS.findIndex((x) => x.id === id);
  const n = INSTRUMENTS.length;
  return INSTRUMENTS[(((i < 0 ? 0 : i) + step) % n + n) % n].id;
}
