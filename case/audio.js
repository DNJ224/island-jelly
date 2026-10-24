// Synthesized stand-ins for the case-opening sequence described in SOUND-REFERENCE.md.
// Unlock, then one tick per card, then a rarity chord. No game audio files.

export function createAudio() {
  let ctx = null;
  let master = null;
  let noise = null;
  let muted = false;

  function context() {
    if (muted) return null;
    if (!ctx) return null;
    return ctx;
  }

  function ensureNoise(seconds) {
    const c = context();
    if (!c) return null;
    if (noise) return noise;
    const length = Math.floor(c.sampleRate * seconds);
    const buffer = c.createBuffer(1, length, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    noise = buffer;
    return noise;
  }

  function arm() {
    if (muted) return;
    try {
      if (!ctx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        ctx = new Ctx();
        master = ctx.createGain();
        master.gain.value = 0.72;
        master.connect(ctx.destination);
      }
      const pending = ctx.resume();
      if (pending && typeof pending.catch === 'function') pending.catch(() => {});
    } catch {
      ctx = null;
      master = null;
    }
  }

  function tone({ type, freq, freqTo, dur, peak, delay, filter }) {
    const c = context();
    if (!c || !master) return;
    const t = c.currentTime + (delay || 0);
    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(1, freq), t);
    if (freqTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqTo), t + dur);
    const gain = c.createGain();
    gain.gain.setValueAtTime(Math.max(peak, 0.0001), t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = osc;
    if (filter) {
      const biquad = c.createBiquadFilter();
      biquad.type = filter.type;
      biquad.frequency.setValueAtTime(filter.freq, t);
      biquad.Q.value = filter.q || 0.7;
      osc.connect(biquad);
      node = biquad;
    }
    node.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function burst({ dur, peak, delay, type, freq, q }) {
    const c = context();
    if (!c || !master) return;
    const buffer = ensureNoise(1);
    if (!buffer) return;
    const t = c.currentTime + (delay || 0);
    const src = c.createBufferSource();
    src.buffer = buffer;
    const filter = c.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t);
    filter.Q.value = q;
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0001), t + Math.min(0.03, dur * 0.25));
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  function unlock() {
    // Low thump plus a band-passed whoosh, about half a second.
    tone({ type: 'sine', freq: 108, freqTo: 46, dur: 0.16, peak: 0.5 });
    tone({ type: 'triangle', freq: 220, freqTo: 90, dur: 0.12, peak: 0.12 });
    burst({ dur: 0.62, peak: 0.2, type: 'bandpass', freq: 900, q: 0.65 });
  }

  function tick(speed, delay) {
    // 1–2 kHz click. Pitch follows reel speed: lower as the reel slows.
    const clamped = Math.max(0, Math.min(1, speed));
    const freq = 980 + clamped * 860;
    const dur = 0.03 - clamped * 0.008;
    tone({
      type: 'triangle',
      freq,
      dur,
      peak: 0.16 + clamped * 0.06,
      delay,
    });
    burst({
      dur: 0.02,
      peak: 0.05 + clamped * 0.04,
      delay,
      type: 'highpass',
      freq: 1400 + clamped * 800,
      q: 0.7,
    });
  }

  function reveal(tier) {
    const chords = {
      milspec: { notes: [523.25, 659.25], dur: 0.6, gap: 0.08, peak: 0.13 },
      restricted: { notes: [523.25, 659.25, 783.99], dur: 0.9, gap: 0.075, peak: 0.13 },
      classified: { notes: [493.88, 659.25, 830.61, 987.77], dur: 1.15, gap: 0.07, peak: 0.12 },
      covert: { notes: [392, 523.25, 659.25, 783.99, 1046.5], dur: 1.55, gap: 0.065, peak: 0.11 },
      rare_special: { notes: [311.13, 392, 523.25, 659.25, 783.99, 1046.5, 1318.51], dur: 1.85, gap: 0.055, peak: 0.11 },
    };
    const chord = chords[tier] || chords.milspec;
    chord.notes.forEach((freq, index) => {
      const delay = index * chord.gap;
      tone({ type: 'sine', freq, dur: chord.dur, peak: chord.peak, delay });
      tone({ type: 'triangle', freq: freq * 2, dur: chord.dur * 0.45, peak: chord.peak * 0.18, delay });
      // A few quiet copies stand in for a short room.
      tone({ type: 'sine', freq, dur: chord.dur * 0.8, peak: chord.peak * 0.22, delay: delay + 0.08 });
    });
    if (tier === 'rare_special' || tier === 'covert') {
      tone({ type: 'sine', freq: 92, freqTo: 48, dur: 0.28, peak: 0.35 });
    }
    if (tier === 'rare_special') {
      tone({ type: 'sine', freq: 1760, dur: 0.9, peak: 0.05, delay: 0.22 });
      burst({ dur: 0.45, peak: 0.06, delay: 0.05, type: 'highpass', freq: 3200, q: 0.8 });
    }
  }

  return {
    arm,
    unlock,
    tick,
    reveal,
    setMuted(value) {
      muted = value;
      if (muted && ctx && ctx.state === 'running') {
        const pending = ctx.suspend();
        if (pending && typeof pending.catch === 'function') pending.catch(() => {});
      }
    },
    get muted() {
      return muted;
    },
  };
}
