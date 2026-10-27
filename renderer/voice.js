// Revue parlée : capture du micro, détection de la parole et découpe en notes vocales WAV.
const RATE = 16000;
const CHUNK = 1024; // 64 ms à 16 kHz
const CHUNK_SEC = CHUNK / RATE;

export function encodeWav(samples, rate = RATE) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

const rms = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * a[i]; return Math.sqrt(s / a.length); };

export class VoiceReview {
  constructor({ onStart, onClip, onLevel, onError, playbackLevel }) {
    Object.assign(this, { onStart, onClip, onLevel, onError, playbackLevel });
    this.mode = 'auto';
    this.active = false;
    this.speaking = false;
    this.noise = 0.004;
    this.leak = 0.25;
    this.pre = [];
    this.chunks = [];
    this.above = 0;
    this.below = 0;
  }

  async start() {
    if (this.active) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('Ce système ne donne pas accès au micro.');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      const why = e && e.name === 'NotAllowedError'
        ? 'L\'accès au micro est refusé. Autorisez « Revue vidéo » dans Réglages Système > Confidentialité et sécurité > Micro (Mac) ou Paramètres > Confidentialité > Microphone (Windows), puis réessayez.'
        : e && e.name === 'NotFoundError' ? 'Aucun micro n\'est branché ou détecté sur cet ordinateur.' : 'Le micro n\'a pas pu démarrer : ' + (e && e.message ? e.message : e);
      throw new Error(why);
    }
    this.ctx = new AudioContext({ sampleRate: RATE });
    await this.ctx.audioWorklet.addModule('vad-worklet.js');
    this.src = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, 'pcm-tap');
    this.node.port.onmessage = (e) => this.feed(e.data);
    this.src.connect(this.node);
    const sink = this.ctx.createGain(); sink.gain.value = 0;
    this.node.connect(sink); sink.connect(this.ctx.destination);
    this.active = true;
  }

  stop() {
    if (!this.active) return;
    if (this.speaking) this.finish(true);
    this.active = false;
    try { this.src.disconnect(); this.node.disconnect(); } catch { /* déjà débranché */ }
    this.stream.getTracks().forEach((t) => t.stop());
    this.ctx.close();
  }

  // Mode « maintenir pour parler »
  pttDown() { if (this.active && this.mode === 'ptt' && !this.speaking) this.begin(0); }
  pttUp() { if (this.active && this.mode === 'ptt' && this.speaking) this.finish(true); }

  begin(backChunks) {
    this.speaking = true;
    const keep = Math.round(0.35 / CHUNK_SEC) + backChunks;
    this.chunks = this.pre.slice(-keep);
    this.startedAt = performance.now() - this.chunks.length * CHUNK_SEC * 1000;
    this.below = 0;
    this.onStart && this.onStart();
  }

  finish(force) {
    this.speaking = false;
    let chunks = this.chunks;
    if (!force) {
      const trailing = this.below - Math.round(0.35 / CHUNK_SEC);
      if (trailing > 0) chunks = chunks.slice(0, chunks.length - trailing);
    }
    this.chunks = [];
    const total = chunks.length * CHUNK;
    const dur = total / RATE;
    if (dur < 0.6) { this.onClip && this.onClip(null); return; }
    const pcm = new Float32Array(total);
    chunks.forEach((c, i) => pcm.set(c, i * CHUNK));
    let peak = 0; for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
    if (peak > 0 && peak < 0.5) { const g = Math.min(4, 0.7 / peak); for (let i = 0; i < pcm.length; i++) pcm[i] *= g; }
    this.onClip && this.onClip({ wav: encodeWav(pcm), duration: dur });
  }

  feed(chunk) {
    const level = rms(chunk);
    this.lastLevel = level;
    this.fed = (this.fed || 0) + 1;
    const play = this.playbackLevel ? this.playbackLevel() : 0;
    const threshold = Math.max(this.noise * 3.2, 0.006, play * this.leak * 2.2);
    this.onLevel && this.onLevel(Math.min(1, level / 0.12), this.speaking);
    this.pre.push(chunk);
    if (this.pre.length > 40) this.pre.shift();

    if (this.mode === 'ptt') {
      if (this.speaking) this.chunks.push(chunk);
      return;
    }
    if (!this.speaking) {
      // Apprend le bruit de fond et la part du son de la vidéo qui revient dans le micro.
      if (level < threshold) {
        this.noise = this.noise * 0.97 + level * 0.03;
        if (play > 0.01) this.leak = Math.min(3, Math.max(0.02, this.leak * 0.97 + (level / play) * 0.03));
      }
      this.above = level > threshold ? this.above + 1 : 0;
      if (this.above >= 3) { this.above = 0; this.begin(0); }
      return;
    }
    this.chunks.push(chunk);
    this.below = level < threshold * 0.75 ? this.below + 1 : 0;
    const maxLen = 90 / CHUNK_SEC;
    if (this.below * CHUNK_SEC >= 1.3 || this.chunks.length > maxLen) this.finish(false);
  }
}
