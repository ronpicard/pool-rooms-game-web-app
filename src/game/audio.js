
/* audio.js — Web Audio synthesis: hum, water lap, drips, footsteps, splash, swim strokes, underwater filter, teleport. */


  /** Tuning constants (seconds / Hz) shared by several voices. */
  const IMPULSE_SECONDS = 2.2;      // reverb tail length
  const NOISE_SECONDS = 2;          // length of the single shared noise buffer
  const DRIP_LOOKAHEAD = 0.5;       // seconds ahead of ctx.currentTime we schedule drips
  const DRIP_MIN_INTERVAL = 0.8;
  const DRIP_MAX_INTERVAL = 6;
  const UNDERWATER_CUTOFF = 420;    // Hz
  const OPEN_CUTOFF = 20000;        // Hz (effectively bypassed)
  const UNDERWATER_RAMP = 0.15;     // seconds
  const VOLUME_RAMP = 0.05;         // seconds, setVolume() / unpause master ramp
  const PAUSE_FADE = 0.04;          // seconds the master fades out before the context is suspended
  const AMBIENT_FADE = 0.4;         // setTargetAtTime time constant for the ambient bed fading in
  const HUM_LEVEL = 0.11;           // steady-state hum layer gain

  /** Swallows promise rejections from resume()/suspend()/close() (autoplay policy, closed context, ...). */
  function noop() {}

  /** Random number in [lo, hi). */
  function rand(lo, hi) {
    return lo + Math.random() * (hi - lo);
  }

  /**
   * Create the game's audio engine. All synthesis is done with the Web Audio API; no audio files are used.
   * Every method is a safe no-op until `unlock()` has created the AudioContext from a user gesture, and stays
   * a no-op forever if the browser has no AudioContext at all.
   * @returns {object} audio API described in CONTRACT §5
   */
  function createAudio() {
    const AudioCtor = window.AudioContext || window.webkitAudioContext || null;

    /** @type {AudioContext|null} */
    let ctx = null;
    let unlocked = false;   // resume() has been requested from a user gesture
    let wantStart = false;  // start() was called before unlock(); honour it on unlock
    let started = false;    // ambient layers running
    let paused = false;
    let disposed = false;
    let underwater = false;
    let volume = 0.8;
    let swimSide = 1;

    // Bus nodes (created together with the context).
    let master = null;      // GainNode -> destination
    let lowpass = null;     // BiquadFilterNode (underwater muffle) -> master
    let dryBus = null;      // GainNode -> lowpass
    let convolver = null;   // ConvolverNode (reverb) -> reverbReturn
    let reverbReturn = null;// GainNode -> lowpass
    let reflectionDelay = null, reflectionFeedback = null, reflectionReturn = null;
    let noiseBuffer = null; // shared 2 s white noise AudioBuffer

    // Ambient layer handles so they can be stopped on dispose().
    /** @type {Array<AudioScheduledSourceNode>} */
    let ambientSources = [];
    let humGain = null, airGain = null;
    let spatialTimer = 0;
    const mix = { environmentVolume: 1, movementVolume: 0.8, musicVolume: 0, gentleSound: false };
    const channels = {};
    let comfortFilter = null, movementReverb = null;
    const rainVoices = [];
    let lapPanner = null, lapFilter = null, oceanGain = null, oceanSwell = null;
    let soundScene = null, listenerPosition = { x: 0, y: 1.6, z: 0 };
    let nextMusicTime = 0, musicRoom = '', endingHeard = false, pierHeard = false;
    const musicVoices = new Set();
    let ambienceRoom = '', nextBirdTime = 0;
    let lapGain = null;     // proximity-controlled water-lap level
    let lapLfoGain = null;  // slow random amplitude modulation of the lap
    let rumbleGain = null;  // underwater low rumble level
    let lapTarget = -1;     // last lap level sent to lapGain (avoid re-scheduling every frame)
    let lapLfoTimer = 0;    // seconds until the next random lap-LFO target
    let nextDripTime = 0;   // ctx time at which the next drip is scheduled
    let dripDensity = 1;    // > 1 => more frequent drips (near water)
    let suspendTimer = 0;   // setTimeout handle: suspend the context once the pause fade-out has finished

    /** True when the context exists and is usable. */
    function live() {
      return !disposed && ctx !== null;
    }

    /**
     * True when a one-shot can actually sound right now: unlocked, not paused and the context clock running.
     * Voices scheduled on a suspended context would all fire together on resume, so they are dropped instead.
     */
    function canPlay() {
      return isReady() && !paused && ctx.state === 'running';
    }

    /** Ramp the master gain from its current value to `target` over `seconds` (click-free). */
    function rampMaster(target, seconds) {
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(target, now + seconds);
    }

    /**
     * Fill an AudioBuffer channel with a decaying noise impulse response.
     * A short dense early-reflection burst plus an exponential tail gives a large tiled-hall feel.
     */
    function buildImpulseResponse() {
      const rate = ctx.sampleRate;
      const length = Math.floor(rate * IMPULSE_SECONDS);
      const ir = ctx.createBuffer(2, length, rate);
      for (let ch = 0; ch < 2; ch++) {
        const data = ir.getChannelData(ch);
        // Independent noise per channel decorrelates the stereo image.
        let lp = 0;
        for (let i = 0; i < length; i++) {
          const t = i / rate;
          const env = Math.exp(-t * 3.1) * (1 - t / IMPULSE_SECONDS);
          // Cheap one-pole low-pass so the tail darkens like a real room (high frequencies die first).
          const alpha = 0.55 - 0.4 * (t / IMPULSE_SECONDS);
          lp += alpha * ((Math.random() * 2 - 1) - lp);
          data[i] = lp * env;
        }
        // Early reflections: a handful of sparse taps in the first 80 ms.
        for (let k = 0; k < 12; k++) {
          const idx = Math.floor(rand(0.004, 0.08) * rate);
          if (idx < length) data[idx] += (Math.random() * 2 - 1) * 0.6;
        }
      }
      return ir;
    }

    /** Create the shared white-noise buffer used by every noise-based voice. */
    function buildNoiseBuffer() {
      const rate = ctx.sampleRate;
      const buffer = ctx.createBuffer(1, Math.floor(rate * NOISE_SECONDS), rate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      return buffer;
    }

    /** Build the master signal graph: sources -> dryBus / convolver -> lowpass -> master -> destination. */
    function buildGraph() {
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(ctx.destination);

      lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = underwater ? UNDERWATER_CUTOFF : OPEN_CUTOFF;
      lowpass.Q.value = 0.5;
      comfortFilter = ctx.createBiquadFilter();
      comfortFilter.type = 'lowpass'; comfortFilter.Q.value = 0.3;
      comfortFilter.frequency.value = mix.gentleSound ? 4800 : OPEN_CUTOFF;
      lowpass.connect(comfortFilter); comfortFilter.connect(master);

      for (const name of ['environment', 'movement', 'music']) {
        const gain = ctx.createGain();
        gain.gain.value = mix[name + 'Volume'] * (name === 'movement' && mix.gentleSound ? 0.65 : 1);
        gain.connect(lowpass); channels[name] = { gain };
      }

      dryBus = ctx.createGain();
      dryBus.gain.value = 1;
      dryBus.connect(channels.environment.gain);

      // ConvolverNode.normalize (default true) equal-power scales the noise IR, so no manual gain compensation.
      convolver = ctx.createConvolver();
      convolver.buffer = buildImpulseResponse();
      reverbReturn = ctx.createGain();
      reverbReturn.gain.value = 0.55;
      convolver.connect(reverbReturn);
      reverbReturn.connect(channels.environment.gain);
      Object.assign(channels.environment, { dry: dryBus, wet: convolver });
      // Separate returns let a category mute silence its echoes as well as its direct sound.
      const movementConvolver = ctx.createConvolver(); movementConvolver.buffer = convolver.buffer;
      movementReverb = ctx.createGain(); movementReverb.gain.value = 0.55;
      movementConvolver.connect(movementReverb); movementReverb.connect(channels.movement.gain);
      Object.assign(channels.movement, { dry: channels.movement.gain, wet: movementConvolver });
      channels.music.dry = channels.music.gain;

      // Sparse echoes make large halls feel wider; the existing convolver softens their tails.
      reflectionDelay = ctx.createDelay(1);
      reflectionDelay.delayTime.value = 0.19;
      reflectionFeedback = ctx.createGain(); reflectionFeedback.gain.value = 0.2;
      reflectionReturn = ctx.createGain(); reflectionReturn.gain.value = 0.08;
      reflectionDelay.connect(reflectionFeedback);
      reflectionFeedback.connect(reflectionDelay);
      reflectionDelay.connect(reflectionReturn);
      reflectionReturn.connect(convolver);

      noiseBuffer = buildNoiseBuffer();
    }

    /**
     * Connect a voice's output node to the dry bus and the reverb send.
     * @param {AudioNode} node
     * @param {number} dry  dry level 0..1
     * @param {number} wet  reverb send level 0..1
     * @returns {GainNode[]} the send gains (so callers can disconnect them when the voice ends)
     */
    function route(node, dry, wet, category = 'environment') {
      const sends = [];
      if (dry > 0) {
        const g = ctx.createGain();
        g.gain.value = dry;
        node.connect(g);
        g.connect(channels[category].dry);
        sends.push(g);
      }
      if (wet > 0) {
        const g = ctx.createGain();
        g.gain.value = wet;
        node.connect(g);
        g.connect(channels[category].wet || channels[category].dry);
        if (category === 'environment') g.connect(reflectionDelay);
        sends.push(g);
      }
      return sends;
    }

    /** Disconnect a one-shot voice's nodes once its last source has ended, so the graph stays small. */
    function cleanupOnEnd(source, nodes) {
      source.onended = function () {
        for (let i = 0; i < nodes.length; i++) {
          try { nodes[i].disconnect(); } catch (e) { /* already disconnected */ }
        }
      };
    }

    /** A noise BufferSource playing the shared buffer from a random offset. */
    function noiseSource(loop) {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      src.loop = !!loop;
      return src;
    }

    /** Random offset into the noise buffer so repeated events do not sound identical. */
    function noiseOffset(duration) {
      return rand(0, Math.max(0, NOISE_SECONDS - duration - 0.01));
    }

    /** Optional stereo panner (absent in older WebKit); returns null when unsupported. */
    function makePanner(pan) {
      if (typeof ctx.createStereoPanner !== 'function') return null;
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      return p;
    }

    function spatialPanner(position, distance = 8) {
      const pan = ctx.createPanner();
      pan.panningModel = 'HRTF'; pan.distanceModel = 'inverse';
      pan.refDistance = distance; pan.rolloffFactor = 1; pan.maxDistance = 140;
      pan.positionX.value = position.x; pan.positionY.value = position.y; pan.positionZ.value = position.z;
      return pan;
    }

    function movePanner(pan, position, now) {
      for (const axis of ['X', 'Y', 'Z']) pan['position' + axis].setTargetAtTime(position[axis.toLowerCase()], now, 0.08);
    }

    /** Schedule an exponential-style decay on a gain param from `peak` at t0 to near-silence at t1. */
    function decay(param, peak, t0, t1) {
      param.setValueAtTime(peak, t0);
      param.exponentialRampToValueAtTime(0.0005, t1);
    }

    /* ------------------------------------------------------------------ ambient layers */

    /** Hum: two detuned oscillators (55 & 110 Hz) with a slow LFO on detune, plus low-passed noise bed. */
    function startHum() {
      const out = ctx.createGain();
      humGain = out;
      out.gain.value = 0;
      route(out, 1, 0.12);

      const oscA = ctx.createOscillator();
      oscA.type = 'sine';
      oscA.frequency.value = 55;
      const oscB = ctx.createOscillator();
      oscB.type = 'triangle';
      oscB.frequency.value = 110;
      oscB.detune.value = 6;
      const gA = ctx.createGain();
      gA.gain.value = 0.7;
      const gB = ctx.createGain();
      gB.gain.value = 0.25;
      oscA.connect(gA);
      oscB.connect(gB);
      gA.connect(out);
      gB.connect(out);

      // Tiny slow LFO on detune (±5 cents) so the hum breathes instead of sitting perfectly still.
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.09;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 5;
      lfo.connect(lfoGain);
      lfoGain.connect(oscA.detune);
      lfoGain.connect(oscB.detune);

      // Pink-ish bed: white noise through a gentle low-pass.
      const noise = noiseSource(true);
      const nf = ctx.createBiquadFilter();
      nf.type = 'lowpass';
      nf.frequency.value = 240;
      nf.Q.value = 0.4;
      const ng = ctx.createGain();
      ng.gain.value = 0.35;
      noise.connect(nf);
      nf.connect(ng);
      ng.connect(out);

      const t = ctx.currentTime;
      oscA.start(t);
      oscB.start(t);
      lfo.start(t);
      noise.start(t, noiseOffset(0));
      out.gain.setTargetAtTime(HUM_LEVEL, t, AMBIENT_FADE);
      ambientSources.push(oscA, oscB, lfo, noise);
    }

    /**
     * Water lap: low-passed noise with a slow random amplitude LFO. Starts silent; update() glides the level
     * toward the proximity target, which doubles as the fade-in.
     */
    function startLap() {
      lapGain = ctx.createGain();
      lapGain.gain.value = 0;
      lapPanner = spatialPanner(listenerPosition, 3);
      lapFilter = ctx.createBiquadFilter(); lapFilter.type = 'lowpass'; lapFilter.frequency.value = 1800;
      lapGain.connect(lapFilter); lapFilter.connect(lapPanner);
      route(lapPanner, 1, 0.35);

      lapLfoGain = ctx.createGain();
      lapLfoGain.gain.value = 0.6;
      lapLfoGain.connect(lapGain);

      const noise = noiseSource(true);
      const f1 = ctx.createBiquadFilter();
      f1.type = 'lowpass';
      f1.frequency.value = 520;
      f1.Q.value = 0.9;
      const f2 = ctx.createBiquadFilter();
      f2.type = 'lowpass';
      f2.frequency.value = 900;
      f2.Q.value = 0.5;
      noise.connect(f1);
      f1.connect(f2);
      f2.connect(lapLfoGain);
      noise.start(ctx.currentTime, noiseOffset(0));
      ambientSources.push(noise);
      lapTarget = -1;
      lapLfoTimer = 0;
    }

    /** Low rumble heard only underwater: very low-passed noise plus a 38 Hz sine. */
    function startRumble() {
      rumbleGain = ctx.createGain();
      rumbleGain.gain.value = 0;
      route(rumbleGain, 1, 0);

      const noise = noiseSource(true);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 95;
      f.Q.value = 1.1;
      const ng = ctx.createGain();
      ng.gain.value = 0.5;
      noise.connect(f);
      f.connect(ng);
      ng.connect(rumbleGain);

      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 38;
      const og = ctx.createGain();
      og.gain.value = 0.18;
      osc.connect(og);
      og.connect(rumbleGain);

      const t = ctx.currentTime;
      noise.start(t, noiseOffset(0));
      osc.start(t);
      rumbleGain.gain.setTargetAtTime(underwater ? 1 : 0, t, AMBIENT_FADE);
      ambientSources.push(noise, osc);
    }

    /**
     * One drip at absolute context time `t`: a short decaying sine with a slight downward glide,
     * a tiny noise tick, random stereo position and a strong reverb send.
     */
    function scheduleDrip(t, position = null, category = 'environment', strength = 1) {
      const freq = rand(900, 2600);
      const level = rand(0.09, 0.19) * strength * (mix.gentleSound ? 0.55 : 1);
      const pan = position ? spatialPanner(position, 3) : makePanner(rand(-0.5, 0.5));
      const out = ctx.createGain();
      out.gain.value = 1;
      const tail = pan || out;
      if (pan) out.connect(pan);
      const sends = route(tail, 0.35, 0.9, category);

      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.82, t + 0.07);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.0005, t);
      og.gain.exponentialRampToValueAtTime(level, t + 0.003);
      og.gain.exponentialRampToValueAtTime(0.0005, t + rand(0.16, 0.3));
      osc.connect(og);
      og.connect(out);

      const tick = noiseSource(false);
      const tf = ctx.createBiquadFilter();
      tf.type = 'highpass';
      tf.frequency.value = 3200;
      const tg = ctx.createGain();
      decay(tg.gain, level * 0.35, t, t + 0.02);
      tick.connect(tf);
      tf.connect(tg);
      tg.connect(out);

      osc.start(t);
      osc.stop(t + 0.32);
      tick.start(t, noiseOffset(0.03), 0.03);
      cleanupOnEnd(osc, [out, og, tg, tf].concat(pan ? [pan] : [], sends));
    }

    function startAir() {
      const source = noiseSource(true), filter = ctx.createBiquadFilter();
      filter.type = 'lowpass'; filter.frequency.value = 650;
      airGain = ctx.createGain(); airGain.gain.value = 0;
      const swell = ctx.createGain(); swell.gain.value = 0.7;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.065;
      const depth = ctx.createGain(); depth.gain.value = 0.25;
      lfo.connect(depth); depth.connect(swell.gain);
      source.connect(filter); filter.connect(swell); swell.connect(airGain);
      route(airGain, 1, 0.02);
      source.start(); lfo.start(); ambientSources.push(source, lfo);

      const ocean = noiseSource(true), wash = ctx.createBiquadFilter();
      wash.type = 'lowpass'; wash.frequency.value = 1100; wash.Q.value = 0.3;
      oceanGain = ctx.createGain(); oceanGain.gain.value = 0;
      oceanSwell = ctx.createGain(); oceanSwell.gain.value = 0.5;
      ocean.connect(wash); wash.connect(oceanSwell); oceanSwell.connect(oceanGain);
      route(oceanGain, 1, 0.01);
      ocean.start(); ambientSources.push(ocean);
      configureRain();
    }

    function configureRain() {
      for (const voice of rainVoices) {
        voice.source.stop();
        for (const node of voice.nodes) node.disconnect();
        ambientSources = ambientSources.filter(source => source !== voice.source);
      }
      rainVoices.length = 0;
      for (const position of soundScene?.rain || []) {
        const source = noiseSource(true), filter = ctx.createBiquadFilter();
        filter.type = 'lowpass'; filter.frequency.value = 2600; filter.Q.value = 0.3;
        const gain = ctx.createGain(); gain.gain.value = 0;
        const pan = spatialPanner(position, 7);
        source.connect(filter); filter.connect(gain); gain.connect(pan);
        const sends = route(pan, 1, 0.5);
        source.start(ctx.currentTime, noiseOffset(0)); ambientSources.push(source);
        rainVoices.push({ source, position, filter, gain, nodes: [source, filter, gain, pan, ...sends] });
      }
    }

    function setScene(scene) {
      soundScene = scene;
      musicRoom = ''; ambienceRoom = ''; endingHeard = false; pierHeard = false;
      stopMusic();
      if (started) { configureRain(); nextMusicTime = ctx.currentTime + 6; }
    }

    function stopMusic() {
      if (!ctx) return;
      for (const voice of musicVoices) {
        const level = voice.gain.gain.value;
        voice.gain.gain.cancelScheduledValues(ctx.currentTime);
        voice.gain.gain.setValueAtTime(level, ctx.currentTime);
        voice.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.5);
        voice.osc.stop(ctx.currentTime + 2);
      }
    }

    // Long envelopes supply the sustain; the score needs no extra convolver or audio files.
    function musicPhrase(room, ending = false, progress = 0) {
      const notes = ending ? [196, 246.94, 293.66, 392] : room === 'Column Sea' ? [146.83, 220, 329.63]
        : room === 'Sky Pool' ? [196, 293.66, 369.99] : [174.61, 261.63, 349.23];
      const start = ctx.currentTime + 0.05;
      notes.forEach((frequency, index) => {
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        const pan = makePanner((index - 1) * 0.22);
        osc.type = 'sine'; osc.frequency.value = frequency; osc.detune.value = rand(-3, 3);
        const t = start + index * (ending ? 0.65 : 2.8);
        const peak = (room === 'Column Sea' ? 0.06 : 0.085) * (1 + progress * 0.3);
        gain.gain.value = 0;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(peak, t + (room === 'Column Sea' ? 0.5 : 3));
        gain.gain.exponentialRampToValueAtTime(0.0005, t + 13);
        gain.gain.linearRampToValueAtTime(0, t + 14);
        osc.connect(gain); if (pan) gain.connect(pan);
        const sends = route(pan || gain, 1, 0, 'music');
        const voice = { osc, gain, nodes: [osc, gain, ...sends, ...(pan ? [pan] : [])] }; musicVoices.add(voice);
        osc.start(t); osc.stop(t + 14.1);
        osc.onended = () => {
          for (const node of voice.nodes) node.disconnect();
          musicVoices.delete(voice);
        };
      });
    }

    function bird(t) {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      const pitch = rand(0.85, 1.12), pan = makePanner(rand(-0.8, 0.8));
      osc.frequency.setValueAtTime(2100 * pitch, t);
      osc.frequency.exponentialRampToValueAtTime(3300 * pitch, t + 0.1);
      osc.frequency.exponentialRampToValueAtTime(2400 * pitch, t + 0.24);
      gain.gain.setValueAtTime(0.0005, t);
      gain.gain.exponentialRampToValueAtTime(0.025, t + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0005, t + 0.28);
      osc.connect(gain); if (pan) gain.connect(pan);
      const sends = route(pan || gain, 1, 0.04);
      osc.start(t); osc.stop(t + 0.3); cleanupOnEnd(osc, [gain, ...(pan ? [pan] : []), ...sends]);
    }

    /** Start all ambient layers; idempotent. */
    function startAmbient() {
      if (started) return;
      started = true;
      startHum();
      startLap();
      startRumble();
      startAir();
      nextDripTime = ctx.currentTime + rand(0.5, 2);
    }

    /* ------------------------------------------------------------------ public API */

    /**
     * Create the AudioContext (must happen inside a user gesture on iOS/Chrome) and resume it.
     * Idempotent and never throws.
     */
    function unlock() {
      if (disposed || !AudioCtor) return;
      if (!ctx) {
        try {
          ctx = new AudioCtor();
          buildGraph();
        } catch (e) {
          ctx = null;
          return;
        }
      }
      unlocked = true;
      try {
        const p = ctx.resume();
        if (p && typeof p.then === 'function') {
          p.then(function () {
            // A gesture may arrive while the pause menu is open: honour the paused flag afterwards.
            if (paused && live()) ctx.suspend().catch(noop);
          }).catch(noop);
        }
      } catch (e) { /* resume() may throw synchronously on closed contexts */ }
      if (wantStart) start();
    }

    /** @returns {boolean} true once the context exists and has been unlocked by a gesture */
    function isReady() {
      return live() && unlocked;
    }

    /** Start ambient layers (hum, water lap, drip scheduler). No-op until unlocked, but remembers the intent. */
    function start() {
      if (disposed) return;
      wantStart = true;
      if (!isReady()) return;
      startAmbient();
    }

    /** Apply validated category levels, including each category's reverb return. */
    function setMix(next) {
      const wasSilent = mix.musicVolume === 0;
      for (const key of ['environmentVolume', 'movementVolume', 'musicVolume']) {
        if (typeof next[key] === 'number' && Number.isFinite(next[key])) mix[key] = Math.min(1, Math.max(0, next[key]));
      }
      if (typeof next.gentleSound === 'boolean') mix.gentleSound = next.gentleSound;
      if (!live()) return;
      for (const name of ['environment', 'movement', 'music']) {
        const gain = channels[name].gain.gain;
        const level = mix[name + 'Volume'] * (name === 'movement' && mix.gentleSound ? 0.65 : 1);
        gain.cancelAndHoldAtTime(ctx.currentTime);
        // Reach actual silence after a bounded fade, including changes made while paused.
        gain.linearRampToValueAtTime(level, ctx.currentTime + 0.05);
      }
      comfortFilter.frequency.setTargetAtTime(mix.gentleSound ? 4800 : OPEN_CUTOFF, ctx.currentTime, 0.1);
      if (!mix.musicVolume) stopMusic();
      else if (wasSilent) nextMusicTime = ctx.currentTime + 1.5;
    }

    /** Master volume with a 50 ms ramp; applied on resume when paused. */
    function setVolume(v) {
      volume = Math.min(1, Math.max(0, Number(v) || 0));
      if (!live() || paused) return;
      rampMaster(volume, VOLUME_RAMP);
    }

    /**
     * Muffle everything (low-pass to 420 Hz) and raise the rumble when the camera is below the water surface.
     * @param {boolean} on
     */
    function setUnderwater(on) {
      on = !!on;
      if (on === underwater) return;
      underwater = on;
      if (!live()) return;
      const now = ctx.currentTime;
      const target = on ? UNDERWATER_CUTOFF : OPEN_CUTOFF;
      lowpass.frequency.cancelScheduledValues(now);
      lowpass.frequency.setValueAtTime(Math.max(20, lowpass.frequency.value), now);
      lowpass.frequency.exponentialRampToValueAtTime(target, now + UNDERWATER_RAMP);
      if (rumbleGain) rumbleGain.gain.setTargetAtTime(on ? 1 : 0, now, 0.12);
    }

    /**
     * Suspend/resume the context (pause menu, hidden tab). Pausing fades the master out over PAUSE_FADE and
     * suspends once the fade is done, so the hum is not cut mid-waveform; a quick unpause cancels the pending
     * suspend. Resume happens only if a gesture already unlocked audio, and ramps the master back to `volume`.
     * @param {boolean} on
     */
    function setPaused(on) {
      paused = !!on;
      clearTimeout(suspendTimer);
      if (!live()) return;
      try {
        if (paused) {
          rampMaster(0, PAUSE_FADE);
          suspendTimer = setTimeout(function () {
            if (!paused || !live()) return;
            try { ctx.suspend().catch(noop); } catch (e) { /* closed context */ }
          }, PAUSE_FADE * 1000 + 10);
        } else if (unlocked) {
          ctx.resume().catch(noop);
          rampMaster(volume, VOLUME_RAMP);
        }
      } catch (e) { /* closed context */ }
    }

    /**
     * Barefoot step: a soft low tap with a broader wet slap after leaving a pool, pitch varied ±15 %.
     * @param {number} [intensity=1] gain multiplier (~1.6 for a landing)
     */
    function footstep(intensity, surface = 'dry') {
      if (!canPlay()) return;
      const amp = intensity === undefined ? 1 : Math.max(0, intensity);
      if (amp <= 0) return; // exponential ramps need a positive target
      const pitch = rand(0.85, 1.15);
      const t = ctx.currentTime;
      const out = ctx.createGain();
      const sends = route(out, 1, 0.22, 'movement');

      const noise = noiseSource(false);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = (surface === 'wet' ? 1400 : 850) * pitch;
      bp.Q.value = 1.3;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.0005, t);
      ng.gain.exponentialRampToValueAtTime((surface === 'wet' ? 0.27 : 0.15) * amp, t + 0.006);
      ng.gain.exponentialRampToValueAtTime(0.0005, t + 0.085);
      noise.connect(bp);
      bp.connect(ng);
      ng.connect(out);

      const click = ctx.createOscillator();
      click.type = 'sine';
      click.frequency.setValueAtTime(120 * pitch, t);
      click.frequency.exponentialRampToValueAtTime(70 * pitch, t + 0.05);
      const cg = ctx.createGain();
      decay(cg.gain, 0.19 * amp, t, t + 0.055);
      click.connect(cg);
      cg.connect(out);

      noise.start(t, noiseOffset(0.1), 0.1);
      click.start(t);
      click.stop(t + 0.06);
      cleanupOnEnd(noise, [out, bp, ng, cg].concat(sends));
    }

    /**
     * Entering water: noise burst with a band-pass sweeping 2000 -> 400 Hz over 0.35 s plus a 90 Hz thump.
     * @param {number} [intensity=1]
     */
    function splash(intensity) {
      if (!canPlay()) return;
      const amp = intensity === undefined ? 1 : Math.max(0, intensity);
      if (amp <= 0) return; // exponential ramps need a positive target
      const t = ctx.currentTime;
      const out = ctx.createGain();
      const sends = route(out, 1, 0.5, 'movement');

      const noise = noiseSource(false);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 0.8;
      bp.frequency.setValueAtTime(2000, t);
      bp.frequency.exponentialRampToValueAtTime(400, t + 0.35);
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.0005, t);
      ng.gain.exponentialRampToValueAtTime(0.55 * amp, t + 0.012);
      ng.gain.exponentialRampToValueAtTime(0.0005, t + 0.42);
      noise.connect(bp);
      bp.connect(ng);
      ng.connect(out);

      const thump = ctx.createOscillator();
      thump.type = 'sine';
      thump.frequency.setValueAtTime(90, t);
      thump.frequency.exponentialRampToValueAtTime(45, t + 0.22);
      const tg = ctx.createGain();
      decay(tg.gain, 0.45 * amp, t, t + 0.26);
      thump.connect(tg);
      tg.connect(out);

      noise.start(t, noiseOffset(0.45), 0.45);
      thump.start(t);
      thump.stop(t + 0.27);
      cleanupOnEnd(noise, [out, bp, ng, tg].concat(sends));
    }

    /** A rounded water pull, surface froth and small bubbles moving past alternating hands. */
    function swimStroke(intensity = 1) {
      if (!canPlay()) return;
      const amp = Math.min(1.5, Math.max(0, Number(intensity) || 0));
      if (!amp) return;
      const t = ctx.currentTime, length = rand(0.62, 0.72);
      const noise = noiseSource(false), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
      const out = ctx.createGain(), pan = makePanner(swimSide * 0.42);
      if (pan) {
        pan.pan.setValueAtTime(swimSide * 0.42, t);
        pan.pan.linearRampToValueAtTime(swimSide * 0.12, t + length);
        out.connect(pan);
      }
      swimSide *= -1;
      const pitch = rand(0.9, 1.1);
      filter.type = 'bandpass'; filter.Q.value = 0.55;
      filter.frequency.setValueAtTime(underwater ? 230 : 380 * pitch, t);
      filter.frequency.exponentialRampToValueAtTime((underwater ? 480 : 950) * pitch, t + 0.16);
      filter.frequency.exponentialRampToValueAtTime(180 * pitch, t + length);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.16 * amp, t + 0.1);
      gain.gain.exponentialRampToValueAtTime(0.045 * amp, t + length * 0.55);
      gain.gain.exponentialRampToValueAtTime(0.0005, t + length);
      gain.gain.linearRampToValueAtTime(0, t + length + 0.03);
      noise.connect(filter); filter.connect(gain); gain.connect(out);
      const sends = route(pan || out, 1, 0.12, 'movement');
      const nodes = [noise, filter, gain, out, ...(pan ? [pan] : []), ...sends];

      // A soft, broad wash at the surface replaces the single narrow noise sweep.
      if (!underwater) {
        const froth = noiseSource(false), foamFilter = ctx.createBiquadFilter(), foamGain = ctx.createGain();
        foamFilter.type = 'bandpass'; foamFilter.Q.value = 0.45;
        foamFilter.frequency.setValueAtTime(2400 * pitch, t);
        foamFilter.frequency.exponentialRampToValueAtTime(800 * pitch, t + 0.38);
        foamGain.gain.setValueAtTime(0, t);
        foamGain.gain.linearRampToValueAtTime(0.055 * amp, t + 0.04);
        foamGain.gain.exponentialRampToValueAtTime(0.0005, t + 0.4);
        foamGain.gain.linearRampToValueAtTime(0, t + 0.44);
        froth.connect(foamFilter); foamFilter.connect(foamGain); foamGain.connect(out);
        froth.start(t, noiseOffset(0.45), 0.45);
        nodes.push(froth, foamFilter, foamGain);
      }
      for (let i=0;i<3;i++) {
        const bubble = ctx.createOscillator(), bubbleGain = ctx.createGain();
        const at = t + 0.16 + i * 0.1 + rand(0, 0.025), frequency = rand(280, 620);
        bubble.frequency.setValueAtTime(frequency, at);
        bubble.frequency.exponentialRampToValueAtTime(frequency * 0.55, at + 0.09);
        bubbleGain.gain.setValueAtTime(0, at);
        bubbleGain.gain.linearRampToValueAtTime(0.022 * amp, at + 0.012);
        bubbleGain.gain.exponentialRampToValueAtTime(0.0005, at + 0.1);
        bubbleGain.gain.linearRampToValueAtTime(0, at + 0.12);
        bubble.connect(bubbleGain); bubbleGain.connect(out);
        bubble.start(at); bubble.stop(at + 0.13);
        nodes.push(bubble, bubbleGain);
      }
      noise.start(t, noiseOffset(length + 0.05), length + 0.05);
      cleanupOnEnd(noise, nodes);
    }

    function waterDrip() {
      if (canPlay()) scheduleDrip(ctx.currentTime, listenerPosition, 'movement', 0.3);
    }

    function ballContact(position, intensity = 1) {
      if (!canPlay()) return;
      const t = ctx.currentTime, osc = ctx.createOscillator(), gain = ctx.createGain();
      const pan = spatialPanner(position, 3);
      osc.frequency.setValueAtTime(180, t); osc.frequency.exponentialRampToValueAtTime(65, t + 0.13);
      gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(Math.min(0.15, intensity * 0.1), t + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0005, t + 0.2);
      osc.connect(gain); gain.connect(pan);
      const sends = route(pan, 1, 0.2, 'movement');
      osc.start(); osc.stop(t + 0.21); cleanupOnEnd(osc, [gain, pan, ...sends]);
    }

    /** Very quiet scuff when leaving the ground. */
    function jump() {
      if (!canPlay()) return;
      const t = ctx.currentTime;
      const noise = noiseSource(false);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 900 * rand(0.9, 1.1);
      bp.Q.value = 1;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0005, t);
      g.gain.exponentialRampToValueAtTime(0.1, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 0.07);
      noise.connect(bp);
      bp.connect(g);
      const sends = route(g, 1, 0.1, 'movement');
      noise.start(t, noiseOffset(0.08), 0.08);
      cleanupOnEnd(noise, [bp, g].concat(sends));
    }

    /** Drain teleport: a rising cluster of sine partials over 1.2 s sent mostly into the reverb (~2 s with tail). */
    function teleport() {
      if (!canPlay()) return;
      const t = ctx.currentTime;
      const out = ctx.createGain();
      out.gain.value = 1;
      const sends = route(out, 0.35, 0.95);
      const ratios = [1, 1.5, 2, 2.5, 3, 4, 5.02, 6.01];
      const base = 165;
      const nodes = [out].concat(sends);
      let last = null;
      for (let i = 0; i < ratios.length; i++) {
        const t0 = t + i * 0.07;
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        const f0 = base * ratios[i] * 0.5;
        osc.frequency.setValueAtTime(f0, t0);
        osc.frequency.exponentialRampToValueAtTime(f0 * 4, t0 + 1.2);
        const g = ctx.createGain();
        const peak = 0.11 / Math.sqrt(ratios[i]);
        g.gain.setValueAtTime(0.0005, t0);
        g.gain.exponentialRampToValueAtTime(peak, t0 + 0.18);
        g.gain.setValueAtTime(peak, t0 + 0.9);
        g.gain.exponentialRampToValueAtTime(0.0005, t0 + 1.7);
        osc.connect(g);
        g.connect(out);
        osc.start(t0);
        osc.stop(t0 + 1.75);
        nodes.push(g);
        last = osc;
      }
      // A soft air swell underneath the partials (high-pass sweeping upward).
      const air = noiseSource(false);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.setValueAtTime(600, t);
      hp.frequency.exponentialRampToValueAtTime(6000, t + 1.3);
      const ag = ctx.createGain();
      ag.gain.setValueAtTime(0.0005, t);
      ag.gain.exponentialRampToValueAtTime(0.08, t + 0.8);
      ag.gain.exponentialRampToValueAtTime(0.0005, t + 1.6);
      air.connect(hp);
      hp.connect(ag);
      ag.connect(out);
      air.start(t, noiseOffset(1.6), 1.6);
      nodes.push(hp, ag);
      cleanupOnEnd(last, nodes);
    }

    /** Tiny menu click. */
    function uiClick() {
      if (!canPlay()) return;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1600, t);
      osc.frequency.exponentialRampToValueAtTime(1100, t + 0.03);
      const g = ctx.createGain();
      decay(g.gain, 0.12, t, t + 0.035);
      osc.connect(g);
      const sends = route(g, 1, 0, 'movement');
      osc.start(t);
      osc.stop(t + 0.04);
      cleanupOnEnd(osc, [g].concat(sends));
    }

    /**
     * Per-frame update: drives the water-lap level, its random LFO and the drip scheduler.
     * @param {number} dt seconds since last call
     * @param {{inWater?:boolean, swimming?:boolean, underwater?:boolean, nearWater?:boolean, speed?:number}} [state]
     */
    function update(dt, state) {
      if (!isReady() || !started || paused) return;
      const s = state || {};
      const now = ctx.currentTime;

      const outdoor = s.room === 'Sky Pool';
      if (s.room !== ambienceRoom) {
        ambienceRoom = s.room;
        humGain.gain.setTargetAtTime(outdoor ? 0 : HUM_LEVEL * (['Sunken Baths','Changing Gallery','Lantern Baths'].includes(s.room) ? 0.4 : 1), now, 2);
        airGain.gain.setTargetAtTime(outdoor ? 0.12 : 0, now, 2);
        reverbReturn.gain.setTargetAtTime(outdoor ? 0.12 : s.room === 'Column Sea' ? 0.85 : 0.55, now, 2);
        movementReverb.gain.setTargetAtTime(outdoor ? 0.05 : s.room === 'Column Sea' ? 0.8 : 0.45, now, 2);
        const cavern = s.room === 'Column Sea', baths = ['Sunken Baths','Changing Gallery','Lantern Baths'].includes(s.room);
        reflectionDelay.delayTime.setTargetAtTime(cavern ? 0.31 : baths ? 0.08 : 0.19, now, 1.5);
        reflectionFeedback.gain.setTargetAtTime(cavern ? 0.42 : 0.2, now, 2);
        reflectionReturn.gain.setTargetAtTime(outdoor ? 0 : cavern ? 0.28 : baths ? 0.04 : 0.1, now, 2);
      }
      listenerPosition = s.position || listenerPosition;
      spatialTimer -= dt;
      if (spatialTimer <= 0) {
        spatialTimer = 0.1;
        const listener = ctx.listener, yaw = s.yaw || 0, pitch = s.pitch || 0;
        if (listener.positionX) {
          movePanner(listener, listenerPosition, now);
          listener.forwardX.setTargetAtTime(-Math.sin(yaw) * Math.cos(pitch), now, 0.05);
          listener.forwardY.setTargetAtTime(Math.sin(pitch), now, 0.05);
          listener.forwardZ.setTargetAtTime(-Math.cos(yaw) * Math.cos(pitch), now, 0.05);
          listener.upX.setTargetAtTime(Math.sin(yaw) * Math.sin(pitch), now, 0.05);
          listener.upY.setTargetAtTime(Math.cos(pitch), now, 0.05);
          listener.upZ.setTargetAtTime(Math.cos(yaw) * Math.sin(pitch), now, 0.05);
        } else {
          listener.setPosition(listenerPosition.x, listenerPosition.y, listenerPosition.z);
          listener.setOrientation(-Math.sin(yaw), 0, -Math.cos(yaw), 0, 1, 0);
        }
        for (const voice of rainVoices) {
          const distance = Math.hypot(voice.position.x-listenerPosition.x, voice.position.z-listenerPosition.z);
          const blocked = distance < 100 && soundScene?.occluded(listenerPosition, voice.position);
          voice.filter.frequency.setTargetAtTime(blocked ? 550 : 2600, now, 0.4);
          voice.gain.gain.setTargetAtTime(distance < 100 && !outdoor ? (blocked ? 0.025 : 0.11) * (voice.position.level ?? 1) : 0, now, 0.6);
        }
        const water = soundScene?.nearestWater(listenerPosition);
        if (s.room === 'Lazy River') {
          const open = soundScene?.river?.openness(listenerPosition.x,listenerPosition.z) || 0;
          reverbReturn.gain.setTargetAtTime(open ? 0.2 : 0.64, now, 1.2);
          movementReverb.gain.setTargetAtTime(open ? 0.14 : 0.55, now, 1.2);
          reflectionDelay.delayTime.setTargetAtTime(open ? 0.07 : 0.22, now, 1.2);
          airGain.gain.setTargetAtTime(open ? 0.035 : 0, now, 1.2);
        }
        if (water) {
          movePanner(lapPanner, water, now);
          lapFilter.frequency.setTargetAtTime(soundScene.occluded(listenerPosition, water) ? 400 : 1800, now, 0.4);
        }
        const pier = soundScene?.pierProgress(listenerPosition) || 0;
        oceanGain.gain.setTargetAtTime(outdoor ? 0.12 + pier * 0.22 : 0, now, 1.5);
        // The same world clock and wave equations drive the visible swells and the wash underneath.
        const swell = soundScene?.oceanHeight(listenerPosition.x, listenerPosition.z, s.time || 0) || 0;
        oceanSwell.gain.setTargetAtTime(0.55 + swell * 0.8, now, 0.2);
      }
      if (s.room !== musicRoom) { musicRoom = s.room; stopMusic(); nextMusicTime = now + 7; }
      if (!s.ending) endingHeard = false;
      const progress = soundScene?.pierProgress(listenerPosition) || 0;
      if (progress === 0) pierHeard = false;
      if (mix.musicVolume > 0 && ((!endingHeard && s.ending) || (!pierHeard && progress > 0.08) || now >= nextMusicTime)) {
        stopMusic();
        musicPhrase(s.room, !!s.ending, progress);
        if (progress > 0.08) pierHeard = true;
        endingHeard = !!s.ending;
        nextMusicTime = now + rand(65, 100);
      }
      if (outdoor && now > nextBirdTime) { bird(now + 0.05); nextBirdTime = now + rand(5, 12); }

      // Water lap level by proximity; the underwater muffle handles the rest of the timbre.
      let target = 0.05;
      if (s.underwater) target = 0.32;
      else if (s.inWater) target = 0.45;
      else if (s.nearWater) target = 0.24;
      if (s.inWater) target += Math.round(Math.min(0.1, (s.speed || 0) * 0.025) * 50) / 50;
      if (target !== lapTarget) {
        lapTarget = target;
        lapGain.gain.setTargetAtTime(target, now, 0.45);
      }

      // Slow random amplitude LFO: pick a new level every 1.2–3.5 s and glide toward it.
      lapLfoTimer -= dt;
      if (lapLfoTimer <= 0) {
        lapLfoTimer = rand(1.2, 3.5);
        lapLfoGain.gain.setTargetAtTime(rand(0.3, 1), now, rand(0.4, 1.2));
      }

      // Drip density: more frequent when water is close.
      dripDensity = (s.inWater || s.nearWater) ? 1.7 : 1;

      // If the context was suspended for a long time the clock did not advance, so this stays in sync;
      // a stale time (e.g. after dispose/rebuild) is simply caught up.
      if (nextDripTime < now - 1) nextDripTime = now + rand(0.2, 1);
      while (nextDripTime <= now + DRIP_LOOKAHEAD) {
        if (!outdoor) {
          const water = soundScene?.nearestWater(listenerPosition);
          if (water) scheduleDrip(nextDripTime, water);
        }
        nextDripTime += rand(DRIP_MIN_INTERVAL, DRIP_MAX_INTERVAL) / dripDensity;
      }
    }

    /** Stop every ambient source, tear down the graph and close the context. Safe to call twice. */
    function dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(suspendTimer);
      if (!ctx) return;
      for (const voice of musicVoices) {
        voice.osc.onended = null;
        voice.osc.stop();
        for (const node of voice.nodes) node.disconnect();
      }
      musicVoices.clear();
      for (let i = 0; i < ambientSources.length; i++) {
        try { ambientSources[i].stop(); } catch (e) { /* not started */ }
        try { ambientSources[i].disconnect(); } catch (e) { /* already gone */ }
      }
      ambientSources = [];
      try { master.disconnect(); } catch (e) { /* already gone */ }
      reflectionDelay?.disconnect();
      reflectionFeedback?.disconnect();
      reflectionReturn?.disconnect();
      try {
        const p = ctx.close();
        if (p && typeof p.catch === 'function') p.catch(noop);
      } catch (e) { /* already closed */ }
      ctx = null;
      started = false;
      unlocked = false;
    }

    return {
      resonate(position) {
        if (!canPlay()) return;
        const t=ctx.currentTime;
        for(const frequency of [220,440.6]) {
          const osc=ctx.createOscillator(), gain=ctx.createGain(), pan=spatialPanner(position,5);
          osc.frequency.value=frequency;
          gain.gain.setValueAtTime(0,t); gain.gain.linearRampToValueAtTime(0.07,t+0.045); gain.gain.exponentialRampToValueAtTime(0.0001,t+3.5);
          osc.connect(gain); gain.connect(pan);
          const sends=route(pan,0.7,0.7);
          osc.start(t); osc.stop(t+3.6); cleanupOnEnd(osc,[gain,pan,...sends]);
        }
      },
      unlock: unlock,
      isReady: isReady,
      start: start,
      setVolume: setVolume,
      setMix, setScene, waterDrip, ballContact, swimStroke,
      setUnderwater: setUnderwater,
      setPaused: setPaused,
      footstep: footstep,
      splash: splash,
      jump: jump,
      teleport: teleport,
      uiClick: uiClick,
      update: update,
      dispose: dispose,
    };
  }

  export { createAudio };
