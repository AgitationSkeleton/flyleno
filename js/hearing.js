// The fly's ears: in-world sound -> Johnston's organ auditory neurons.
//   low band  (30–300 Hz, the range of fly courtship song) -> JO-B
//   high band (300–4000 Hz)                                -> JO-A
//   onsets (spectral flux)                                 -> brief extra burst on both
// Sources:
//   * "piped" (default): a capture of this browser tab's audio (getDisplayMedia, current tab), so the
//     YouTube music's real waveform (after its volume slider) plus Leno and the crowd are heard.
//   * fallback: the sim's own sound bus (Leno, crowd, SFX) + an ESTIMATE for the music from the
//     YouTube player's volume and play state (the iframe's waveform is not readable cross-origin).
export class Hearing {
  constructor(audio, music) {
    this.audio = audio; this.music = music;
    this.mode = 'off';           // 'piped' | 'internal' | 'off'
    this.maxRate = 150;          // Hz at full loudness
    this.gain = 1;
    this.low = 0; this.high = 0; this.onset = 0;
    this.prevSpec = null;
  }

  attachInternal() {
    const ctx = this.audio.ctx;
    this.intAnalyser = ctx.createAnalyser(); this.intAnalyser.fftSize = 2048; this.intAnalyser.smoothingTimeConstant = 0.3;
    this.audio.bus.connect(this.intAnalyser);
    if (this.mode === 'off') this.mode = 'internal';
  }

  /** Must run inside a user gesture. Resolves true if tab audio is being captured. */
  async pipeTabAudio() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 10, width: { max: 960 } }, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        preferCurrentTab: true, selfBrowserSurface: 'include', systemAudio: 'include', surfaceSwitching: 'exclude',
      });
      // keep the picture too: the stage screens use it to let the fly see a YouTube video (js/screens.js)
      const vt = stream.getVideoTracks()[0];
      if (vt) {
        this.captureVideo = document.createElement('video');
        this.captureVideo.muted = true; this.captureVideo.playsInline = true;
        this.captureVideo.srcObject = new MediaStream([vt]);
        this.captureVideo.play().catch(() => {});
      }
      if (!stream.getAudioTracks().length) throw new Error('no audio track shared (tick "share tab audio")');
      const ctx = this.audio.ctx;
      this.capSrc = ctx.createMediaStreamSource(stream);
      this.capAnalyser = ctx.createAnalyser(); this.capAnalyser.fftSize = 2048; this.capAnalyser.smoothingTimeConstant = 0.3;
      this.capSrc.connect(this.capAnalyser);            // analysed only, never played back
      stream.getAudioTracks()[0].onended = () => { this.mode = 'internal'; this.onChange?.(); };
      this.mode = 'piped';
      this.onChange?.();
      return true;
    } catch (e) {
      this.error = e.message || String(e);
      if (this.mode === 'off' && this.intAnalyser) this.mode = 'internal';
      this.onChange?.();
      return false;
    }
  }

  bands(an) {
    const bins = an.frequencyBinCount, spec = new Float32Array(bins);
    an.getFloatFrequencyData(spec);
    const hz = this.audio.ctx.sampleRate / 2 / bins;
    let lo = 0, hi = 0, nl = 0, nh = 0, flux = 0;
    for (let i = 1; i < bins; i++) {
      const f = i * hz, p = Math.pow(10, spec[i] / 10);            // power
      if (f >= 30 && f < 300) { lo += p; nl++; } else if (f >= 300 && f < 4000) { hi += p; nh++; }
      if (this.prevSpec && f < 4000) flux += Math.max(0, spec[i] - this.prevSpec[i]);
    }
    this.prevSpec = spec;
    const db = (x, n) => 10 * Math.log10(x / Math.max(1, n) + 1e-12);
    return { low: db(lo, nl), high: db(hi, nh), flux: flux / bins };
  }

  /** Returns firing rates (Hz) for the two JO populations. Call ~20x/s. */
  update() {
    if (this.mode === 'off' || !this.audio.ctx) return { low: 0, high: 0 };
    const an = this.mode === 'piped' ? this.capAnalyser : this.intAnalyser;
    const b = this.bands(an);
    // map -90..-30 dB (per-bin average power) to 0..1
    const norm = (d) => Math.max(0, Math.min(1, (d + 90) / 60));
    let low = norm(b.low), high = norm(b.high);
    if (this.mode !== 'piped' && this.music?.isPlaying) {
      // music estimate: player volume only (no waveform available without tab capture)
      const v = (this.music.volume / 100) * 0.7;
      low = Math.max(low, v * (0.8 + 0.2 * Math.sin(performance.now() / 250)));
      high = Math.max(high, v * 0.6);
    }
    const sv = this.mode !== 'piped' ? (this.screenVideo?.() ?? 0) : 0;   // YouTube on the stage screen (estimate)
    if (sv > 0) { low = Math.max(low, sv * 0.75 * (0.8 + 0.2 * Math.sin(performance.now() / 180))); high = Math.max(high, sv * 0.7); }
    this.onset = Math.max(this.onset * 0.6, Math.min(1, b.flux / 3));
    const k = 0.5;
    this.low += (low - this.low) * k; this.high += (high - this.high) * k;
    const r = this.maxRate * this.gain;
    return { low: r * Math.min(1, this.low + 0.5 * this.onset), high: r * Math.min(1, this.high + 0.5 * this.onset), level: Math.max(this.low, this.high) };
  }
}
