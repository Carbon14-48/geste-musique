// Enregistrement d'une prise : la planche (canvas) + le son, en WebM, entièrement dans le navigateur.

function pickMime() {
  const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
  return candidates.find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) ?? '';
}

export class TakeRecorder {
  constructor() {
    this.recorders = [];
    this.startedAt = 0;
  }

  get active() {
    return this.recorders.length > 0;
  }

  elapsed() {
    if (!this.active) return '';
    const s = Math.floor((performance.now() - this.startedAt) / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  /** @param {{canvas:HTMLCanvasElement, name:string}[]} targets @param {MediaStream|null} audio */
  start(targets, audio) {
    if (this.active) return;
    const mimeType = pickMime();
    this.recorders = targets.map(({ canvas, name }) => {
      const tracks = [...canvas.captureStream(30).getVideoTracks(), ...(audio ? audio.getAudioTracks() : [])];
      const rec = new MediaRecorder(new MediaStream(tracks), { mimeType, videoBitsPerSecond: 6_000_000 });
      const chunks = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.start(1000);
      return { rec, chunks, name, mimeType: rec.mimeType || mimeType };
    });
    this.startedAt = performance.now();
  }

  /** @returns {Promise<{blob:Blob, name:string}[]>} */
  async stop() {
    const done = await Promise.all(
      this.recorders.map(
        ({ rec, chunks, name, mimeType }) =>
          new Promise((resolve) => {
            rec.onstop = () => resolve({ blob: new Blob(chunks, { type: mimeType }), name, ext: mimeType.includes('mp4') ? 'mp4' : 'webm' });
            rec.stop();
          }),
      ),
    );
    this.recorders = [];
    return done;
  }
}
