// 말 놓는 소리. 파일 없이 나무 부딪히는 소리를 합성한다.
class Sounds {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.volume = 0.8;
  }

  unlock() {
    if (!this.ctx) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return;
      this.ctx = new Context();
      this.noise = this.makeNoise(this.ctx);
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
  }

  makeNoise(ctx) {
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  // 나무 말이 판에 닿는 소리: 짧은 잡음(딱)에 나무 울림(톡)을 더한다.
  knock(ctx, noise, at, { pitch = 1, level = 1 } = {}) {
    const out = ctx.createGain();
    out.gain.value = level * this.volume;
    out.connect(ctx.destination);

    const click = ctx.createBufferSource();
    click.buffer = noise;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 2300 * pitch;
    band.Q.value = 2.2;
    const clickGain = ctx.createGain();
    clickGain.gain.setValueAtTime(0.9, at);
    clickGain.gain.exponentialRampToValueAtTime(0.001, at + 0.03);
    click.connect(band).connect(clickGain).connect(out);
    click.start(at);
    click.stop(at + 0.05);

    for (const [freq, gain, decay] of [[880, 0.5, 0.05], [1730, 0.22, 0.035], [310, 0.5, 0.09]]) {
      const tone = ctx.createOscillator();
      tone.type = "sine";
      tone.frequency.setValueAtTime(freq * pitch * 1.04, at);
      tone.frequency.exponentialRampToValueAtTime(freq * pitch, at + 0.02);
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain, at);
      g.gain.exponentialRampToValueAtTime(0.001, at + decay);
      tone.connect(g).connect(out);
      tone.start(at);
      tone.stop(at + decay + 0.01);
    }
  }

  play(hits) {
    if (!this.enabled || !this.ctx) return;
    const start = this.ctx.currentTime + 0.005;
    for (const [delay, options] of hits) this.knock(this.ctx, this.noise, start + delay, options);
  }

  place(taken) {
    this.play(taken
      ? [[0, { pitch: 0.92, level: 1 }], [0.055, { pitch: 1.05, level: 0.55 }]]
      : [[0, { pitch: 1, level: 0.9 }]]);
  }

  check() {
    this.play([[0, { pitch: 1.25, level: 0.9 }], [0.11, { pitch: 1.25, level: 0.9 }]]);
  }

  finish() {
    this.play([[0, { pitch: 0.7, level: 0.9 }], [0.16, { pitch: 0.6, level: 0.7 }]]);
  }
}
