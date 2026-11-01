// Fully synthesized audio (WebAudio) — no asset files. Started on first user gesture.
export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.musicOn = true;
    this.last = {};
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 4;
    this.master.connect(comp).connect(this.ctx.destination);
    this.sfx = this.ctx.createGain(); this.sfx.gain.value = 0.9; this.sfx.connect(this.master);
    this.music = this.ctx.createGain(); this.music.gain.value = 0.22; this.music.connect(this.master);
    this.noiseBuf = this._noise(2);
    this._startMusic();
  }

  toggleMute() { this.muted = !this.muted; if (this.master) this.master.gain.value = this.muted ? 0 : 0.55; if (this.muted) speechSynthesis?.cancel(); return this.muted; }

  /** Radio-style voice callouts via the OS speech engine (no assets). */
  say(text, priority = false) {
    if (this.muted || this.voiceOff || !window.speechSynthesis) return;
    const now = performance.now();
    if (!priority && this.lastSay && now - this.lastSay < 4500) return;
    if (speechSynthesis.speaking) { if (!priority) return; speechSynthesis.cancel(); }
    this.lastSay = now;
    const u = new SpeechSynthesisUtterance(text);
    if (!this.voice) {
      const voices = speechSynthesis.getVoices();
      this.voice = voices.find(v => /en-US/i.test(v.lang) && /(Guy|Christopher|Eric|David|Mark)/i.test(v.name)) || voices.find(v => /en-US/i.test(v.lang)) || voices[0] || null;
    }
    if (this.voice) u.voice = this.voice;
    u.rate = 1.08; u.pitch = 0.85; u.volume = 0.85;
    speechSynthesis.speak(u);
  }

  toggleVoice() { this.voiceOff = !this.voiceOff; if (this.voiceOff) speechSynthesis?.cancel(); return !this.voiceOff; }

  _noise(sec) {
    const b = this.ctx.createBuffer(1, this.ctx.sampleRate * sec, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  _throttle(name, ms) {
    const now = performance.now();
    if (this.last[name] && now - this.last[name] < ms) return true;
    this.last[name] = now;
    return false;
  }

  _env(g, t, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  tone(freq, dur = 0.12, type = 'square', vol = 0.12, slideTo = null, when = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    this._env(g, t, 0.005, vol, dur);
    o.connect(g).connect(this.sfx);
    o.start(t); o.stop(t + dur + 0.05);
  }

  noise(dur, { vol = 0.5, f0 = 800, f1 = 200, q = 0.8, type = 'lowpass', when = 0, attack = 0.01 } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = this.ctx.createGain(); this._env(g, t, attack, vol, dur);
    s.connect(f).connect(g).connect(this.sfx);
    s.start(t); s.stop(t + dur + attack + 0.05);
  }

  // ------------------------------------------------------------------ sfx vocabulary
  click() { if (!this._throttle('click', 40)) this.tone(1800, 0.04, 'square', 0.05); }
  hover() { if (!this._throttle('hover', 70)) this.tone(2600, 0.02, 'sine', 0.025); }
  select() { this.tone(880, 0.06, 'square', 0.06); this.tone(1320, 0.08, 'square', 0.05, null, 0.05); }
  confirm() { [440, 660, 880].forEach((f, i) => this.tone(f, 0.1, 'sawtooth', 0.06, null, i * 0.06)); this.noise(0.4, { vol: 0.12, f0: 3000, f1: 400, type: 'bandpass' }); }
  launchJet() { if (this._throttle('jet', 120)) return; this.noise(1.6, { vol: 0.35, f0: 300, f1: 2500, type: 'bandpass', q: 1.2, attack: 0.15 }); }
  launchMissile() { if (this._throttle('msl', 90)) return; this.noise(1.1, { vol: 0.4, f0: 600, f1: 3000, type: 'highpass', attack: 0.02 }); this.tone(200, 0.6, 'sawtooth', 0.05, 900); }
  explosion(power = 1) {
    if (this._throttle('boom', 60)) return;
    const v = Math.min(1, 0.35 + power * 0.18);
    this.noise(0.9 + power * 0.4, { vol: v, f0: 1800, f1: 60, q: 0.5 });
    this.tone(70, 0.6 + power * 0.2, 'sine', v * 0.6, 30);
  }
  rod() { this.noise(2.2, { vol: 0.5, f0: 8000, f1: 200, type: 'bandpass', q: 2, attack: 1.2 }); this.tone(1200, 1.4, 'sine', 0.08, 120); }
  cyber() { for (let i = 0; i < 8; i++) this.tone(600 + Math.random() * 2400, 0.03, 'square', 0.04, null, i * 0.045); }
  scan() { this.tone(400, 0.9, 'sine', 0.06, 1600); }
  success() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.09, null, i * 0.09)); }
  fail() { [392, 330, 262].forEach((f, i) => this.tone(f, 0.3, 'sawtooth', 0.07, null, i * 0.14)); }
  alarm() { if (this._throttle('alarm', 1500)) return; for (let i = 0; i < 4; i++) { this.tone(880, 0.18, 'square', 0.08, null, i * 0.36); this.tone(660, 0.18, 'square', 0.08, null, i * 0.36 + 0.18); } }
  intercept() { this.tone(1500, 0.25, 'sawtooth', 0.06, 300); this.noise(0.3, { vol: 0.25, f0: 4000, f1: 800, type: 'bandpass' }); }
  gunfire() { if (this._throttle('gun', 150)) return; for (let i = 0; i < 6; i++) this.noise(0.05, { vol: 0.18, f0: 2500, f1: 1200, type: 'bandpass', when: i * 0.06 }); }

  // ------------------------------------------------------------------ music: slow minor-key pad + pulse
  _startMusic() {
    const ctx = this.ctx;
    const out = ctx.createBiquadFilter(); out.type = 'lowpass'; out.frequency.value = 900; out.Q.value = 0.7;
    out.connect(this.music);
    const chords = [[110, 130.8, 164.8], [98, 123.5, 146.8], [87.3, 110, 130.8], [82.4, 103.8, 123.5]];
    const voices = [0, 1, 2].map(() => {
      const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain();
      o1.type = 'sawtooth'; o2.type = 'sawtooth'; o2.detune.value = 9;
      g.gain.value = 0.05;
      o1.connect(g); o2.connect(g); g.connect(out);
      o1.start(); o2.start();
      return [o1, o2];
    });
    const lfo = ctx.createOscillator(), lfoG = ctx.createGain();
    lfo.frequency.value = 0.07; lfoG.gain.value = 380;
    lfo.connect(lfoG).connect(out.frequency); lfo.start();
    let i = 0;
    const step = () => {
      const t = ctx.currentTime;
      chords[i % chords.length].forEach((f, k) => voices[k].forEach(o => o.frequency.setTargetAtTime(f, t, 1.2)));
      // heartbeat pulse
      for (let b = 0; b < 4; b++) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = 55;
        const tt = t + b * 2;
        g.gain.setValueAtTime(0.0001, tt); g.gain.exponentialRampToValueAtTime(0.35, tt + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.5);
        o.connect(g).connect(this.music); o.start(tt); o.stop(tt + 0.6);
      }
      i++;
    };
    step();
    this.musicTimer = setInterval(step, 8000);
  }

  setTension(t) {
    // Music gets brighter and louder as the world heats up.
    if (!this.ctx) return;
    this.music.gain.setTargetAtTime(0.16 + t * 0.0018, this.ctx.currentTime, 2);
  }
}
