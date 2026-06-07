export class InstrumentEngine {
  constructor(ctx, masterGain) {
    this.ctx = ctx
    this.masterGain = masterGain
    this.activeNotes = new Map()
    this.instrument = 'piano'
    this.volume = 0.7
    this.reverbNode = this._makeReverb()
    this.reverbGain = ctx.createGain()
    this.reverbGain.gain.value = 0.15
    this.reverbNode.connect(this.reverbGain)
    this.reverbGain.connect(this.masterGain)
  }

  _makeReverb() {
    const len = this.ctx.sampleRate * 1.5
    const buf = this.ctx.createBuffer(2, len, this.ctx.sampleRate)
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch)
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3)
    }
    const conv = this.ctx.createConvolver()
    conv.buffer = buf
    return conv
  }

  _makeEnvelope(gainNode, attack, decay, sustain) {
    const now = this.ctx.currentTime
    gainNode.gain.setValueAtTime(0, now)
    gainNode.gain.linearRampToValueAtTime(this.volume, now + attack)
    gainNode.gain.linearRampToValueAtTime(sustain * this.volume, now + attack + decay)
  }

  _releaseEnvelope(gainNode, release) {
    const now = this.ctx.currentTime
    gainNode.gain.cancelScheduledValues(now)
    gainNode.gain.setValueAtTime(gainNode.gain.value, now)
    gainNode.gain.linearRampToValueAtTime(0, now + release)
    return release
  }

  playNote(noteId, freq, instrumentOverride = null) {
    if (this.activeNotes.has(noteId)) this.stopNote(noteId, true)

    const gainNode = this.ctx.createGain()
    gainNode.connect(this.masterGain)
    gainNode.connect(this.reverbNode)

    let nodes = []
    const instrument = instrumentOverride || this.instrument

    switch (instrument) {
      case 'piano':    nodes = this._piano(freq, gainNode); break
      case 'synth':    nodes = this._synth(freq, gainNode); break
      case 'organ':    nodes = this._organ(freq, gainNode); break
      case 'bass':     nodes = this._bass(freq, gainNode); break
      case 'epiano':   nodes = this._epiano(freq, gainNode); break
      case 'bells':    nodes = this._bells(freq, gainNode); break
      case 'strings':  nodes = this._strings(freq, gainNode); break
      case 'flute':    nodes = this._flute(freq, gainNode); break
      case 'pad':      nodes = this._pad(freq, gainNode); break
      case 'marimba':  nodes = this._marimba(freq, gainNode); break
      case 'lead':     nodes = this._lead(freq, gainNode); break
      case 'guitar':   nodes = this._guitar(freq, gainNode); break
      case 'banjo':    nodes = this._banjo(freq, gainNode); break
      case 'ocarina':  nodes = this._ocarina(freq, gainNode); break
      case 'trumpet':  nodes = this._trumpet(freq, gainNode); break
      case 'accordion':nodes = this._accordion(freq, gainNode); break
      case 'violin':   nodes = this._violin(freq, gainNode); break
      case 'saxophone':nodes = this._saxophone(freq, gainNode); break
      case 'kalimba':  nodes = this._kalimba(freq, gainNode); break
      case 'musicbox': nodes = this._musicbox(freq, gainNode); break
      case 'steeldrum':nodes = this._steeldrum(freq, gainNode); break
      case 'theremin': nodes = this._theremin(freq, gainNode); break
      case 'toypiano': nodes = this._toypiano(freq, gainNode); break
      case 'fmsynth':  nodes = this._fmsynth(freq, gainNode); break
      case 'wobble':   nodes = this._wobble(freq, gainNode); break
    }

    this.activeNotes.set(noteId, { gainNode, nodes, instrument })
  }

  stopNote(noteId, immediate = false) {
    const entry = this.activeNotes.get(noteId)
    if (!entry) return
    const { gainNode, nodes, instrument } = entry

    const releaseTime = immediate ? 0.01 : this._getReleaseTime(instrument)
    const now = this.ctx.currentTime
    gainNode.gain.cancelScheduledValues(now)
    gainNode.gain.setValueAtTime(gainNode.gain.value, now)
    gainNode.gain.linearRampToValueAtTime(0, now + releaseTime)

    setTimeout(() => {
      nodes.forEach(n => { try { n.stop?.(); n.disconnect?.() } catch {} })
      gainNode.disconnect()
    }, (releaseTime + 0.05) * 1000)

    this.activeNotes.delete(noteId)
  }

  stopAll() {
    for (const [id] of this.activeNotes) this.stopNote(id)
  }

  _getReleaseTime(instrument = null) {
    return {
      piano: 0.8, synth: 0.2, organ: 0.05, bass: 0.3,
      epiano: 0.9, bells: 1.5, strings: 0.6, flute: 0.3, pad: 1.0, marimba: 0.5, lead: 0.15,
      guitar: 1.2, banjo: 0.8, ocarina: 0.2, trumpet: 0.15, accordion: 0.1,
      violin: 0.4, saxophone: 0.2, kalimba: 1.5, musicbox: 1.8, steeldrum: 1.0,
      theremin: 0.3, toypiano: 0.6, fmsynth: 0.3, wobble: 0.2,
    }[instrument || this.instrument] ?? 0.3
  }

  _piano(freq, output) {
    const now = this.ctx.currentTime

    // Slightly inharmonic partials (real piano strings stretch sharp on upper harmonics)
    const osc1 = this.ctx.createOscillator()
    osc1.type = 'triangle'
    osc1.frequency.value = freq

    const osc2 = this.ctx.createOscillator()
    osc2.type = 'sine'
    osc2.frequency.value = freq * 2.003

    const osc3 = this.ctx.createOscillator()
    osc3.type = 'sine'
    osc3.frequency.value = freq * 3.008

    const osc4 = this.ctx.createOscillator()
    osc4.type = 'sine'
    osc4.frequency.value = freq * 4.02

    // Short filtered-noise "hammer" transient for attack bite
    const hammerBuf = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.05, this.ctx.sampleRate)
    const hd = hammerBuf.getChannelData(0)
    for (let i = 0; i < hd.length; i++) hd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / hd.length, 2)
    const hammer = this.ctx.createBufferSource()
    hammer.buffer = hammerBuf
    const hammerFilter = this.ctx.createBiquadFilter()
    hammerFilter.type = 'bandpass'
    hammerFilter.frequency.value = freq * 3
    hammerFilter.Q.value = 0.7
    const hammerGain = this.ctx.createGain()
    hammerGain.gain.setValueAtTime(0.5, now)
    hammerGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05)
    hammer.connect(hammerFilter); hammerFilter.connect(hammerGain); hammerGain.connect(output)

    // Brightness filter that closes down as the note decays (hammer strike → mellow body)
    const filter = this.ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.Q.value = 0.5
    filter.frequency.setValueAtTime(Math.min(freq * 9, 14000), now)
    filter.frequency.exponentialRampToValueAtTime(Math.max(freq * 1.6, 400), now + 2.2)

    const mix1 = this.ctx.createGain(); mix1.gain.value = 0.62
    const mix2 = this.ctx.createGain(); mix2.gain.value = 0.22
    const mix3 = this.ctx.createGain(); mix3.gain.value = 0.1
    const mix4 = this.ctx.createGain(); mix4.gain.value = 0.05

    osc1.connect(mix1); mix1.connect(filter)
    osc2.connect(mix2); mix2.connect(filter)
    osc3.connect(mix3); mix3.connect(filter)
    osc4.connect(mix4); mix4.connect(filter)
    filter.connect(output)

    // Struck-string envelope: instant attack, then continuous exponential decay
    // (a real piano note never "sustains" flat — it keeps fading even while held)
    output.gain.cancelScheduledValues(now)
    output.gain.setValueAtTime(0, now)
    output.gain.linearRampToValueAtTime(this.volume, now + 0.004)
    output.gain.exponentialRampToValueAtTime(Math.max(this.volume * 0.001, 0.0001), now + 4.5)

    osc1.start(now); osc2.start(now); osc3.start(now); osc4.start(now); hammer.start(now)
    return [osc1, osc2, osc3, osc4, hammer, filter]
  }

  _synth(freq, output) {
    const osc1 = this.ctx.createOscillator()
    osc1.type = 'sawtooth'
    osc1.frequency.value = freq

    const osc2 = this.ctx.createOscillator()
    osc2.type = 'square'
    osc2.frequency.value = freq * 1.005 // slight detune

    const filter = this.ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = freq * 4
    filter.Q.value = 3

    const now = this.ctx.currentTime
    filter.frequency.setValueAtTime(freq * 8, now)
    filter.frequency.exponentialRampToValueAtTime(freq * 2, now + 0.4)

    const mix1 = this.ctx.createGain(); mix1.gain.value = 0.5
    const mix2 = this.ctx.createGain(); mix2.gain.value = 0.5

    osc1.connect(mix1); mix1.connect(filter)
    osc2.connect(mix2); mix2.connect(filter)
    filter.connect(output)

    this._makeEnvelope(output, 0.01, 0.1, 0.7)
    osc1.start(); osc2.start()
    return [osc1, osc2, filter]
  }

  _organ(freq, output) {
    const harmonics = [1, 2, 3, 4, 6, 8]
    const gains =     [1, 0.7, 0.5, 0.3, 0.15, 0.1]
    const oscs = harmonics.map((h, i) => {
      const osc = this.ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = freq * h
      const g = this.ctx.createGain()
      g.gain.value = gains[i] * 0.25
      osc.connect(g); g.connect(output)
      osc.start()
      return osc
    })
    this._makeEnvelope(output, 0.01, 0.01, 0.9)
    return oscs
  }

  _epiano(freq, output) {
    const now = this.ctx.currentTime

    // Classic Rhodes/Wurlitzer-style FM: a sine carrier with a higher-ratio
    // sine modulator whose depth spikes on attack then quickly decays —
    // that's the "bark"/bell bite that mellows into a pure tone.
    const carrier = this.ctx.createOscillator()
    carrier.type = 'sine'
    carrier.frequency.value = freq

    const modulator = this.ctx.createOscillator()
    modulator.type = 'sine'
    modulator.frequency.value = freq * 3.97 // slightly inharmonic ratio = bell-like bite

    const modGain = this.ctx.createGain()
    modGain.gain.setValueAtTime(freq * 1.8, now)
    modGain.gain.exponentialRampToValueAtTime(Math.max(freq * 0.05, 1), now + 0.5)
    modulator.connect(modGain)
    modGain.connect(carrier.frequency)

    // Sub-octave body for warmth + a soft 2nd-harmonic shimmer
    const sub = this.ctx.createOscillator()
    sub.type = 'sine'
    sub.frequency.value = freq * 0.5
    const shimmer = this.ctx.createOscillator()
    shimmer.type = 'sine'
    shimmer.frequency.value = freq * 2.003

    // Tremolo (vibrato-like amplitude wobble, classic e-piano "chorus/vibe" character)
    const tremoloOsc = this.ctx.createOscillator()
    tremoloOsc.frequency.value = 4.5
    const tremoloGain = this.ctx.createGain()
    tremoloGain.gain.value = 0.06
    tremoloOsc.connect(tremoloGain)
    tremoloGain.connect(output.gain)

    const mix1 = this.ctx.createGain(); mix1.gain.value = 0.65
    const mix2 = this.ctx.createGain(); mix2.gain.value = 0.18
    const mix3 = this.ctx.createGain(); mix3.gain.value = 0.12
    carrier.connect(mix1); mix1.connect(output)
    sub.connect(mix2); mix2.connect(output)
    shimmer.connect(mix3); mix3.connect(output)

    // Soft attack, gentle continuous decay (electric piano notes ring out and fade)
    output.gain.cancelScheduledValues(now)
    output.gain.setValueAtTime(0, now)
    output.gain.linearRampToValueAtTime(this.volume, now + 0.012)
    output.gain.exponentialRampToValueAtTime(Math.max(this.volume * 0.15, 0.0001), now + 3.5)

    carrier.start(now); modulator.start(now); sub.start(now); shimmer.start(now); tremoloOsc.start(now)
    return [carrier, modulator, sub, shimmer, tremoloOsc]
  }

  _bells(freq, output) {
    const ratios = [1, 2.756, 5.404, 8.933]
    const gains  = [1, 0.4, 0.2, 0.08]
    const oscs = ratios.map((r, i) => {
      const osc = this.ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = freq * r
      const g = this.ctx.createGain(); g.gain.value = gains[i] * 0.35
      const now = this.ctx.currentTime
      g.gain.setValueAtTime(gains[i] * 0.35 * this.volume, now)
      g.gain.exponentialRampToValueAtTime(0.0001, now + 2.5)
      osc.connect(g); g.connect(output)
      osc.start()
      return osc
    })
    output.gain?.setValueAtTime(1, this.ctx.currentTime)
    return oscs
  }

  _strings(freq, output) {
    const oscs = [-0.1, 0, 0.1].map(detune => {
      const osc = this.ctx.createOscillator()
      osc.type = 'sawtooth'
      osc.frequency.value = freq * Math.pow(2, detune / 12)
      const g = this.ctx.createGain(); g.gain.value = 0.25
      osc.connect(g); g.connect(output)
      osc.start()
      return osc
    })
    const filter = this.ctx.createBiquadFilter()
    filter.type = 'lowpass'; filter.frequency.value = freq * 3; filter.Q.value = 0.5
    this._makeEnvelope(output, 0.25, 0.1, 0.7)
    return oscs
  }

  _flute(freq, output) {
    const osc = this.ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = freq * 2 // flute is bright/high

    // Breath noise
    const bufLen = this.ctx.sampleRate * 0.5
    const buf = this.ctx.createBuffer(1, bufLen, this.ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < bufLen; i++) d[i] = (Math.random() * 2 - 1) * 0.04
    const noise = this.ctx.createBufferSource()
    noise.buffer = buf; noise.loop = true
    const noiseFilter = this.ctx.createBiquadFilter()
    noiseFilter.type = 'bandpass'; noiseFilter.frequency.value = freq * 2; noiseFilter.Q.value = 5
    const noiseGain = this.ctx.createGain(); noiseGain.gain.value = 0.3

    // Vibrato
    const vibOsc = this.ctx.createOscillator()
    vibOsc.frequency.value = 5.5
    const vibGain = this.ctx.createGain(); vibGain.gain.value = freq * 0.01
    vibOsc.connect(vibGain); vibGain.connect(osc.frequency)

    const oscGain = this.ctx.createGain(); oscGain.gain.value = 0.6
    osc.connect(oscGain); oscGain.connect(output)
    noise.connect(noiseFilter); noiseFilter.connect(noiseGain); noiseGain.connect(output)

    this._makeEnvelope(output, 0.08, 0.05, 0.8)
    osc.start(); noise.start(); vibOsc.start()
    return [osc, noise, vibOsc]
  }

  _pad(freq, output) {
    const oscs = [1, 1.5, 2, 3].map((ratio, i) => {
      const osc = this.ctx.createOscillator()
      osc.type = i % 2 === 0 ? 'sine' : 'triangle'
      osc.frequency.value = freq * ratio
      const g = this.ctx.createGain(); g.gain.value = [0.4, 0.2, 0.15, 0.08][i]
      osc.connect(g); g.connect(output)
      osc.start()
      return osc
    })
    this._makeEnvelope(output, 0.4, 0.2, 0.8)
    return oscs
  }

  _marimba(freq, output) {
    const ratios = [1, 4, 10]
    const oscs = ratios.map((r, i) => {
      const osc = this.ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = freq * r
      const g = this.ctx.createGain()
      const now = this.ctx.currentTime
      const decay = [0.6, 0.2, 0.1][i]
      g.gain.setValueAtTime([0.8, 0.3, 0.1][i] * this.volume, now)
      g.gain.exponentialRampToValueAtTime(0.0001, now + decay)
      osc.connect(g); g.connect(output)
      osc.start()
      return osc
    })
    output.gain?.setValueAtTime(1, this.ctx.currentTime)
    return oscs
  }

  _lead(freq, output) {
    const osc1 = this.ctx.createOscillator()
    osc1.type = 'square'
    osc1.frequency.value = freq
    const osc2 = this.ctx.createOscillator()
    osc2.type = 'square'
    osc2.frequency.value = freq * 1.008

    const filter = this.ctx.createBiquadFilter()
    filter.type = 'lowpass'; filter.frequency.value = freq * 6; filter.Q.value = 4

    const now = this.ctx.currentTime
    filter.frequency.setValueAtTime(freq * 10, now)
    filter.frequency.exponentialRampToValueAtTime(freq * 3, now + 0.1)

    const mix1 = this.ctx.createGain(); mix1.gain.value = 0.45
    const mix2 = this.ctx.createGain(); mix2.gain.value = 0.45
    osc1.connect(mix1); mix1.connect(filter)
    osc2.connect(mix2); mix2.connect(filter)
    filter.connect(output)
    this._makeEnvelope(output, 0.005, 0.05, 0.9)
    osc1.start(); osc2.start()
    return [osc1, osc2, filter]
  }

  _bass(freq, output) {
    const osc1 = this.ctx.createOscillator()
    osc1.type = 'sawtooth'
    osc1.frequency.value = freq / 2 // one octave down

    const filter = this.ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 600
    filter.Q.value = 1.5

    const now = this.ctx.currentTime
    filter.frequency.setValueAtTime(1200, now)
    filter.frequency.exponentialRampToValueAtTime(300, now + 0.15)

    osc1.connect(filter); filter.connect(output)
    this._makeEnvelope(output, 0.005, 0.1, 0.5)
    osc1.start()
    return [osc1, filter]
  }

  // Karplus-Strong plucked string
  _guitar(freq, output) {
    const sampleRate = this.ctx.sampleRate
    const N = Math.round(sampleRate / freq)
    const buf = this.ctx.createBuffer(1, N, sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < N; i++) d[i] = Math.random() * 2 - 1
    const source = this.ctx.createBufferSource()
    source.buffer = buf; source.loop = true
    // Low-pass feedback approximation via IIR
    const filter = this.ctx.createBiquadFilter()
    filter.type = 'lowpass'; filter.frequency.value = freq * 6
    const gain = this.ctx.createGain(); gain.gain.value = 0.85
    source.connect(filter); filter.connect(gain); gain.connect(output)
    this._makeEnvelope(output, 0.001, 0.05, 0.6)
    source.start()
    // Auto decay
    const now = this.ctx.currentTime
    output.gain.setValueAtTime(this.volume, now + 0.06)
    output.gain.exponentialRampToValueAtTime(0.0001, now + 1.8)
    return [source, filter]
  }

  // Banjo - brighter/twangier Karplus
  _banjo(freq, output) {
    const sampleRate = this.ctx.sampleRate
    const N = Math.round(sampleRate / freq)
    const buf = this.ctx.createBuffer(1, N, sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < N; i++) d[i] = Math.random() * 2 - 1
    const source = this.ctx.createBufferSource()
    source.buffer = buf; source.loop = true
    const filter = this.ctx.createBiquadFilter()
    filter.type = 'highpass'; filter.frequency.value = freq * 1.5
    const filter2 = this.ctx.createBiquadFilter()
    filter2.type = 'peaking'; filter2.frequency.value = freq * 3; filter2.gain.value = 8
    source.connect(filter); filter.connect(filter2); filter2.connect(output)
    this._makeEnvelope(output, 0.001, 0.02, 0.5)
    source.start()
    const now = this.ctx.currentTime
    output.gain.setValueAtTime(this.volume * 0.9, now + 0.02)
    output.gain.exponentialRampToValueAtTime(0.0001, now + 1.2)
    return [source, filter, filter2]
  }

  // Ocarina - pure breathy sine
  _ocarina(freq, output) {
    const osc = this.ctx.createOscillator()
    osc.type = 'sine'; osc.frequency.value = freq
    const osc2 = this.ctx.createOscillator()
    osc2.type = 'sine'; osc2.frequency.value = freq * 2.98
    const m1 = this.ctx.createGain(); m1.gain.value = 0.75
    const m2 = this.ctx.createGain(); m2.gain.value = 0.08
    // Breath noise
    const bufLen = this.ctx.sampleRate * 0.5
    const buf = this.ctx.createBuffer(1, bufLen, this.ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < bufLen; i++) d[i] = (Math.random() * 2 - 1) * 0.025
    const noise = this.ctx.createBufferSource(); noise.buffer = buf; noise.loop = true
    const nf = this.ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = freq; nf.Q.value = 8
    osc.connect(m1); m1.connect(output)
    osc2.connect(m2); m2.connect(output)
    noise.connect(nf); nf.connect(output)
    this._makeEnvelope(output, 0.06, 0.05, 0.9)
    osc.start(); osc2.start(); noise.start()
    return [osc, osc2, noise]
  }

  // Trumpet - buzzy square with bright filter
  _trumpet(freq, output) {
    const osc = this.ctx.createOscillator()
    osc.type = 'square'; osc.frequency.value = freq
    const osc2 = this.ctx.createOscillator()
    osc2.type = 'sawtooth'; osc2.frequency.value = freq * 1.003
    const filter = this.ctx.createBiquadFilter()
    filter.type = 'bandpass'; filter.frequency.value = freq * 3; filter.Q.value = 1.5
    const now = this.ctx.currentTime
    filter.frequency.setValueAtTime(freq * 8, now)
    filter.frequency.exponentialRampToValueAtTime(freq * 2.5, now + 0.08)
    const m1 = this.ctx.createGain(); m1.gain.value = 0.5
    const m2 = this.ctx.createGain(); m2.gain.value = 0.5
    osc.connect(m1); m1.connect(filter)
    osc2.connect(m2); m2.connect(filter)
    filter.connect(output)
    this._makeEnvelope(output, 0.02, 0.05, 0.85)
    osc.start(); osc2.start()
    return [osc, osc2, filter]
  }

  // Accordion - detuned sawtooths
  _accordion(freq, output) {
    const detunes = [-0.15, 0, 0.15]
    const oscs = detunes.map(d => {
      const osc = this.ctx.createOscillator()
      osc.type = 'sawtooth'
      osc.frequency.value = freq * Math.pow(2, d / 12)
      const g = this.ctx.createGain(); g.gain.value = 0.28
      const filter = this.ctx.createBiquadFilter()
      filter.type = 'lowpass'; filter.frequency.value = freq * 5
      osc.connect(filter); filter.connect(g); g.connect(output)
      osc.start()
      return osc
    })
    // Tremolo
    const trem = this.ctx.createOscillator(); trem.frequency.value = 7.5
    const tremG = this.ctx.createGain(); tremG.gain.value = 0.12
    trem.connect(tremG); tremG.connect(output.gain ?? output)
    this._makeEnvelope(output, 0.04, 0.05, 0.88)
    trem.start()
    return [...oscs, trem]
  }

  // Violin - bowed string: detuned saws + vibrato
  _violin(freq, output) {
    const oscs = [-0.08, 0, 0.08].map(dt => {
      const osc = this.ctx.createOscillator()
      osc.type = 'sawtooth'
      osc.frequency.value = freq * Math.pow(2, dt / 12)
      const g = this.ctx.createGain(); g.gain.value = 0.3
      osc.connect(g); g.connect(output)
      osc.start()
      return osc
    })
    // Vibrato
    const vib = this.ctx.createOscillator(); vib.frequency.value = 6
    const vibG = this.ctx.createGain(); vibG.gain.value = freq * 0.015
    vib.connect(vibG)
    oscs.forEach(o => vibG.connect(o.frequency))
    // Rosin filter
    const filter = this.ctx.createBiquadFilter()
    filter.type = 'bandpass'; filter.frequency.value = freq * 2; filter.Q.value = 0.8
    this._makeEnvelope(output, 0.18, 0.05, 0.75)
    vib.start()
    return [...oscs, vib]
  }

  // Saxophone - filtered square with growl
  _saxophone(freq, output) {
    const osc = this.ctx.createOscillator()
    osc.type = 'square'; osc.frequency.value = freq
    const filter = this.ctx.createBiquadFilter()
    filter.type = 'bandpass'; filter.frequency.value = freq * 2.2; filter.Q.value = 2
    const filter2 = this.ctx.createBiquadFilter()
    filter2.type = 'peaking'; filter2.frequency.value = freq * 0.5; filter2.gain.value = 6
    // Sub octave growl
    const osc2 = this.ctx.createOscillator()
    osc2.type = 'sawtooth'; osc2.frequency.value = freq * 0.5
    const growl = this.ctx.createGain(); growl.gain.value = 0.08
    osc.connect(filter); filter.connect(filter2); filter2.connect(output)
    osc2.connect(growl); growl.connect(output)
    this._makeEnvelope(output, 0.03, 0.06, 0.8)
    osc.start(); osc2.start()
    return [osc, osc2, filter, filter2]
  }

  // Kalimba - metallic tine pluck
  _kalimba(freq, output) {
    const ratios = [1, 4.07, 10.6]
    const gains  = [1, 0.25, 0.08]
    const decays = [2.0, 0.8, 0.3]
    const now = this.ctx.currentTime
    const oscs = ratios.map((r, i) => {
      const osc = this.ctx.createOscillator()
      osc.type = 'sine'; osc.frequency.value = freq * r
      const g = this.ctx.createGain()
      g.gain.setValueAtTime(gains[i] * this.volume * 0.7, now)
      g.gain.exponentialRampToValueAtTime(0.0001, now + decays[i])
      osc.connect(g); g.connect(output)
      osc.start()
      return osc
    })
    output.gain?.setValueAtTime(1, now)
    return oscs
  }

  // Music box - delicate sine bells with high harmonics
  _musicbox(freq, output) {
    const ratios = [1, 3.0, 6.2, 10.5]
    const gains  = [1, 0.35, 0.12, 0.04]
    const decays = [2.5, 1.2, 0.6, 0.3]
    const now = this.ctx.currentTime
    const oscs = ratios.map((r, i) => {
      const osc = this.ctx.createOscillator()
      osc.type = 'sine'; osc.frequency.value = freq * r
      const g = this.ctx.createGain()
      g.gain.setValueAtTime(gains[i] * this.volume * 0.5, now)
      g.gain.exponentialRampToValueAtTime(0.0001, now + decays[i])
      osc.connect(g); g.connect(output)
      osc.start()
      return osc
    })
    output.gain?.setValueAtTime(1, now)
    return oscs
  }

  // Steel drum - Caribbean metallic ring
  _steeldrum(freq, output) {
    const ratios = [1, 2.0, 3.1, 4.35]
    const gains  = [1, 0.5, 0.2, 0.08]
    const decays = [1.5, 0.8, 0.5, 0.25]
    const now = this.ctx.currentTime
    const oscs = ratios.map((r, i) => {
      const osc = this.ctx.createOscillator()
      osc.type = 'sine'; osc.frequency.value = freq * r
      const g = this.ctx.createGain()
      g.gain.setValueAtTime(gains[i] * this.volume * 0.65, now)
      g.gain.exponentialRampToValueAtTime(0.0001, now + decays[i])
      osc.connect(g); g.connect(output)
      osc.start()
      return osc
    })
    output.gain?.setValueAtTime(1, now)
    return oscs
  }

  // Theremin - eerie smooth sine with slow vibrato
  _theremin(freq, output) {
    const osc = this.ctx.createOscillator()
    osc.type = 'sine'; osc.frequency.value = freq
    const osc2 = this.ctx.createOscillator()
    osc2.type = 'sine'; osc2.frequency.value = freq * 2
    const m1 = this.ctx.createGain(); m1.gain.value = 0.8
    const m2 = this.ctx.createGain(); m2.gain.value = 0.1
    const vib = this.ctx.createOscillator(); vib.frequency.value = 4.5
    const vibG = this.ctx.createGain(); vibG.gain.value = freq * 0.018
    vib.connect(vibG); vibG.connect(osc.frequency); vibG.connect(osc2.frequency)
    osc.connect(m1); m1.connect(output)
    osc2.connect(m2); m2.connect(output)
    this._makeEnvelope(output, 0.15, 0.1, 0.9)
    osc.start(); osc2.start(); vib.start()
    return [osc, osc2, vib]
  }

  // Toy piano - crunchy detuned sines
  _toypiano(freq, output) {
    // Slightly detuned and with extra brightness
    const offsets = [0, 7] // cents
    const oscs = offsets.map((ct, i) => {
      const osc = this.ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = freq * Math.pow(2, ct / 1200)
      const g = this.ctx.createGain(); g.gain.value = i === 0 ? 0.65 : 0.2
      osc.connect(g); g.connect(output)
      osc.start()
      return osc
    })
    // Extra harmonic crunch
    const osc3 = this.ctx.createOscillator()
    osc3.type = 'triangle'; osc3.frequency.value = freq * 3.01
    const g3 = this.ctx.createGain(); g3.gain.value = 0.08
    osc3.connect(g3); g3.connect(output)
    this._makeEnvelope(output, 0.002, 0.15, 0.3)
    osc3.start()
    return [...oscs, osc3]
  }

  // FM Synth - DX7-style two-operator FM
  _fmsynth(freq, output) {
    const carrier = this.ctx.createOscillator()
    carrier.type = 'sine'; carrier.frequency.value = freq
    const modulator = this.ctx.createOscillator()
    modulator.type = 'sine'; modulator.frequency.value = freq * 2.0
    const modGain = this.ctx.createGain()
    const now = this.ctx.currentTime
    modGain.gain.setValueAtTime(freq * 3.5, now)
    modGain.gain.exponentialRampToValueAtTime(freq * 0.5, now + 0.4)
    modulator.connect(modGain); modGain.connect(carrier.frequency)
    carrier.connect(output)
    this._makeEnvelope(output, 0.005, 0.15, 0.6)
    carrier.start(); modulator.start()
    return [carrier, modulator, modGain]
  }

  // Wobble bass - LFO-modulated sawtooth
  _wobble(freq, output) {
    const osc = this.ctx.createOscillator()
    osc.type = 'sawtooth'; osc.frequency.value = freq / 2
    const filter = this.ctx.createBiquadFilter()
    filter.type = 'lowpass'; filter.frequency.value = 800; filter.Q.value = 8
    // LFO on filter cutoff
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 4
    const lfoGain = this.ctx.createGain(); lfoGain.gain.value = 600
    lfo.connect(lfoGain); lfoGain.connect(filter.frequency)
    osc.connect(filter); filter.connect(output)
    this._makeEnvelope(output, 0.01, 0.05, 0.8)
    osc.start(); lfo.start()
    return [osc, filter, lfo]
  }
}

// ---- Drum synthesizer ----
export function playDrum(ctx, masterGain, type, time = null, customBuffer = null) {
  const now = (typeof time === 'number' && time > 0) ? time : ctx.currentTime
  if (customBuffer) {
    const source = ctx.createBufferSource()
    source.buffer = customBuffer
    const gain = ctx.createGain()
    gain.gain.value = 0.9
    source.connect(gain); gain.connect(masterGain)
    source.start(now)
    return
  }

  switch (type) {
    case 'kick': {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain); gain.connect(masterGain)
      osc.frequency.setValueAtTime(150, now)
      osc.frequency.exponentialRampToValueAtTime(40, now + 0.15)
      gain.gain.setValueAtTime(1, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4)
      osc.start(now); osc.stop(now + 0.4)
      break
    }
    case 'snare': {
      // Noise
      const bufLen = ctx.sampleRate * 0.2
      const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate)
      const d = buf.getChannelData(0)
      for (let i = 0; i < bufLen; i++) d[i] = Math.random() * 2 - 1
      const noise = ctx.createBufferSource()
      noise.buffer = buf
      const noiseFilter = ctx.createBiquadFilter()
      noiseFilter.type = 'highpass'; noiseFilter.frequency.value = 1000
      const noiseGain = ctx.createGain()
      noise.connect(noiseFilter); noiseFilter.connect(noiseGain); noiseGain.connect(masterGain)
      noiseGain.gain.setValueAtTime(0.8, now)
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2)
      noise.start(now)
      // Tone
      const osc = ctx.createOscillator()
      osc.frequency.value = 180
      const oscGain = ctx.createGain()
      osc.connect(oscGain); oscGain.connect(masterGain)
      oscGain.gain.setValueAtTime(0.6, now)
      oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1)
      osc.start(now); osc.stop(now + 0.1)
      break
    }
    case 'hihat-closed': {
      const bufLen = ctx.sampleRate * 0.08
      const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate)
      const d = buf.getChannelData(0)
      for (let i = 0; i < bufLen; i++) d[i] = Math.random() * 2 - 1
      const noise = ctx.createBufferSource()
      noise.buffer = buf
      const filter = ctx.createBiquadFilter()
      filter.type = 'highpass'; filter.frequency.value = 7000
      const gain = ctx.createGain()
      noise.connect(filter); filter.connect(gain); gain.connect(masterGain)
      gain.gain.setValueAtTime(0.6, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08)
      noise.start(now)
      break
    }
    case 'hihat-open': {
      const bufLen = ctx.sampleRate * 0.4
      const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate)
      const d = buf.getChannelData(0)
      for (let i = 0; i < bufLen; i++) d[i] = Math.random() * 2 - 1
      const noise = ctx.createBufferSource()
      noise.buffer = buf
      const filter = ctx.createBiquadFilter()
      filter.type = 'highpass'; filter.frequency.value = 6000
      const gain = ctx.createGain()
      noise.connect(filter); filter.connect(gain); gain.connect(masterGain)
      gain.gain.setValueAtTime(0.5, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4)
      noise.start(now)
      break
    }
    case 'clap': {
      for (let burst = 0; burst < 3; burst++) {
        const t = now + burst * 0.012
        const bufLen = ctx.sampleRate * 0.05
        const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate)
        const d = buf.getChannelData(0)
        for (let i = 0; i < bufLen; i++) d[i] = Math.random() * 2 - 1
        const noise = ctx.createBufferSource()
        noise.buffer = buf
        const filter = ctx.createBiquadFilter()
        filter.type = 'bandpass'; filter.frequency.value = 1200; filter.Q.value = 0.7
        const gain = ctx.createGain()
        noise.connect(filter); filter.connect(gain); gain.connect(masterGain)
        gain.gain.setValueAtTime(burst === 2 ? 0.8 : 0.4, t)
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08)
        noise.start(t)
      }
      break
    }
    case 'tom-hi': {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain); gain.connect(masterGain)
      osc.frequency.setValueAtTime(300, now)
      osc.frequency.exponentialRampToValueAtTime(120, now + 0.2)
      gain.gain.setValueAtTime(0.9, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25)
      osc.start(now); osc.stop(now + 0.25)
      break
    }
    case 'tom-lo': {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain); gain.connect(masterGain)
      osc.frequency.setValueAtTime(180, now)
      osc.frequency.exponentialRampToValueAtTime(60, now + 0.3)
      gain.gain.setValueAtTime(0.9, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35)
      osc.start(now); osc.stop(now + 0.35)
      break
    }
    case 'crash': {
      const bufLen = ctx.sampleRate * 1.2
      const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate)
      const d = buf.getChannelData(0)
      for (let i = 0; i < bufLen; i++) d[i] = Math.random() * 2 - 1
      const noise = ctx.createBufferSource()
      noise.buffer = buf
      const filter = ctx.createBiquadFilter()
      filter.type = 'highpass'; filter.frequency.value = 5000
      const gain = ctx.createGain()
      noise.connect(filter); filter.connect(gain); gain.connect(masterGain)
      gain.gain.setValueAtTime(0.6, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 1.2)
      noise.start(now)
      break
    }
    case 'rimshot': {
      const osc = ctx.createOscillator()
      osc.type = 'triangle'
      osc.frequency.value = 400
      const gain = ctx.createGain()
      osc.connect(gain); gain.connect(masterGain)
      gain.gain.setValueAtTime(0.8, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06)
      osc.start(now); osc.stop(now + 0.06)
      break
    }
    case 'kick-808': {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      const dist = ctx.createWaveShaper()
      const curve = new Float32Array(256)
      for (let i = 0; i < 256; i++) {
        const x = (i * 2) / 256 - 1
        curve[i] = (Math.PI + 80) * x / (Math.PI + 80 * Math.abs(x))
      }
      dist.curve = curve
      osc.connect(dist); dist.connect(gain); gain.connect(masterGain)
      osc.frequency.setValueAtTime(80, now)
      osc.frequency.exponentialRampToValueAtTime(28, now + 0.8)
      gain.gain.setValueAtTime(1.2, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.9)
      osc.start(now); osc.stop(now + 0.9)
      break
    }
    case 'snare-elect': {
      const bufLen = ctx.sampleRate * 0.15
      const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate)
      const d = buf.getChannelData(0)
      for (let i = 0; i < bufLen; i++) d[i] = Math.random() * 2 - 1
      const noise = ctx.createBufferSource(); noise.buffer = buf
      const filter = ctx.createBiquadFilter()
      filter.type = 'bandpass'; filter.frequency.value = 3000; filter.Q.value = 0.5
      const gain = ctx.createGain()
      noise.connect(filter); filter.connect(gain); gain.connect(masterGain)
      gain.gain.setValueAtTime(1, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15)
      // Pitch swept tone
      const osc = ctx.createOscillator()
      osc.frequency.setValueAtTime(500, now)
      osc.frequency.exponentialRampToValueAtTime(200, now + 0.1)
      const og = ctx.createGain()
      osc.connect(og); og.connect(masterGain)
      og.gain.setValueAtTime(0.5, now)
      og.gain.exponentialRampToValueAtTime(0.001, now + 0.1)
      noise.start(now); osc.start(now); osc.stop(now + 0.1)
      break
    }
    case 'cowbell': {
      const freqs = [562, 845]
      freqs.forEach(f => {
        const osc = ctx.createOscillator()
        osc.type = 'square'; osc.frequency.value = f
        const filter = ctx.createBiquadFilter()
        filter.type = 'bandpass'; filter.frequency.value = f; filter.Q.value = 5
        const gain = ctx.createGain()
        osc.connect(filter); filter.connect(gain); gain.connect(masterGain)
        gain.gain.setValueAtTime(0.4, now)
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8)
        osc.start(now); osc.stop(now + 0.8)
      })
      break
    }
    case 'shaker': {
      const bufLen = ctx.sampleRate * 0.12
      const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate)
      const d = buf.getChannelData(0)
      for (let i = 0; i < bufLen; i++) {
        const env = Math.sin((i / bufLen) * Math.PI)
        d[i] = (Math.random() * 2 - 1) * env
      }
      const noise = ctx.createBufferSource(); noise.buffer = buf
      const filter = ctx.createBiquadFilter()
      filter.type = 'highpass'; filter.frequency.value = 8000
      const gain = ctx.createGain()
      noise.connect(filter); filter.connect(gain); gain.connect(masterGain)
      gain.gain.value = 0.5
      noise.start(now)
      break
    }
    case 'woodblock': {
      const osc = ctx.createOscillator()
      osc.type = 'sine'; osc.frequency.value = 900
      const osc2 = ctx.createOscillator()
      osc2.type = 'sine'; osc2.frequency.value = 1200
      const gain = ctx.createGain()
      osc.connect(gain); osc2.connect(gain); gain.connect(masterGain)
      gain.gain.setValueAtTime(0.7, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07)
      osc.start(now); osc2.start(now); osc.stop(now + 0.07); osc2.stop(now + 0.07)
      break
    }
    case 'bongo-hi': {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain); gain.connect(masterGain)
      osc.frequency.setValueAtTime(520, now)
      osc.frequency.exponentialRampToValueAtTime(280, now + 0.12)
      gain.gain.setValueAtTime(0.85, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18)
      osc.start(now); osc.stop(now + 0.18)
      break
    }
    case 'bongo-lo': {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain); gain.connect(masterGain)
      osc.frequency.setValueAtTime(320, now)
      osc.frequency.exponentialRampToValueAtTime(160, now + 0.15)
      gain.gain.setValueAtTime(0.9, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22)
      osc.start(now); osc.stop(now + 0.22)
      break
    }
    case 'ride': {
      const bufLen = ctx.sampleRate * 0.8
      const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate)
      const d = buf.getChannelData(0)
      for (let i = 0; i < bufLen; i++) d[i] = Math.random() * 2 - 1
      const noise = ctx.createBufferSource(); noise.buffer = buf
      const filter = ctx.createBiquadFilter()
      filter.type = 'bandpass'; filter.frequency.value = 4000; filter.Q.value = 2
      const gain = ctx.createGain()
      noise.connect(filter); filter.connect(gain); gain.connect(masterGain)
      gain.gain.setValueAtTime(0.35, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8)
      // Bell ping
      const bell = ctx.createOscillator()
      bell.frequency.value = 3200
      const bg = ctx.createGain()
      bell.connect(bg); bg.connect(masterGain)
      bg.gain.setValueAtTime(0.25, now)
      bg.gain.exponentialRampToValueAtTime(0.001, now + 0.4)
      noise.start(now); bell.start(now); bell.stop(now + 0.4)
      break
    }
  }
}

// Full note range C1-C8
function _midiFreq(midi) { return 440 * Math.pow(2, (midi - 69) / 12) }
const _NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
export const ALL_NOTES = []
for (let midi = 24; midi <= 108; midi++) {
  const oct = Math.floor(midi / 12) - 1
  const name = _NAMES[midi % 12]
  ALL_NOTES.push({
    id: `${name.replace('#','s')}${oct}`,
    midi,
    freq: _midiFreq(midi),
    label: name.replace('#',''),
    sharp: name.includes('#'),
    black: name.includes('#'),
    octave: oct,
    semitone: midi % 12,
  })
}

// Legacy export for anything still importing NOTES
export const NOTES = ALL_NOTES.filter(n => n.midi >= 48 && n.midi <= 65)

// ---- General MIDI program -> our synth instrument mapping ----
// GM defines 128 standard instrument "programs" (0-127), grouped in families
// of 8. We map each one to whichever of our synth voices sounds closest, so
// imported MIDI files can auto-switch instruments per track/channel.
const GM_INSTRUMENT_MAP = [
  // 0-7: Piano
  'piano', 'piano', 'epiano', 'piano', 'epiano', 'epiano', 'toypiano', 'toypiano',
  // 8-15: Chromatic Percussion
  'musicbox', 'bells', 'musicbox', 'bells', 'marimba', 'marimba', 'bells', 'kalimba',
  // 16-23: Organ
  'organ', 'organ', 'organ', 'organ', 'accordion', 'accordion', 'saxophone', 'accordion',
  // 24-31: Guitar
  'guitar', 'guitar', 'guitar', 'guitar', 'guitar', 'guitar', 'guitar', 'guitar',
  // 32-39: Bass
  'bass', 'bass', 'bass', 'bass', 'bass', 'bass', 'bass', 'bass',
  // 40-47: Strings
  'violin', 'violin', 'violin', 'violin', 'strings', 'strings', 'kalimba', 'marimba',
  // 48-55: Ensemble
  'strings', 'strings', 'strings', 'strings', 'pad', 'pad', 'pad', 'synth',
  // 56-63: Brass
  'trumpet', 'trumpet', 'trumpet', 'trumpet', 'trumpet', 'trumpet', 'synth', 'synth',
  // 64-71: Reed
  'saxophone', 'saxophone', 'saxophone', 'saxophone', 'saxophone', 'saxophone', 'saxophone', 'saxophone',
  // 72-79: Pipe
  'flute', 'flute', 'ocarina', 'ocarina', 'ocarina', 'ocarina', 'ocarina', 'ocarina',
  // 80-87: Synth Lead
  'synth', 'synth', 'lead', 'lead', 'wobble', 'pad', 'synth', 'wobble',
  // 88-95: Synth Pad
  'pad', 'pad', 'pad', 'pad', 'strings', 'fmsynth', 'pad', 'pad',
  // 96-103: Synth Effects
  'theremin', 'pad', 'bells', 'pad', 'fmsynth', 'wobble', 'theremin', 'fmsynth',
  // 104-111: Ethnic
  'banjo', 'banjo', 'banjo', 'kalimba', 'kalimba', 'accordion', 'violin', 'saxophone',
  // 112-119: Percussive
  'bells', 'steeldrum', 'steeldrum', 'marimba', 'marimba', 'marimba', 'fmsynth', 'theremin',
  // 120-127: Sound Effects
  'guitar', 'theremin', 'theremin', 'ocarina', 'bells', 'theremin', 'theremin', 'synth',
]

export function gmProgramToInstrument(program) {
  return GM_INSTRUMENT_MAP[program] ?? 'piano'
}

// ---- General MIDI percussion key map (channel 10 / index 9) -> our drum types ----
const GM_DRUM_MAP = {
  35: 'kick', 36: 'kick', 37: 'rimshot', 38: 'snare', 39: 'clap',
  40: 'snare-elect', 41: 'tom-lo', 42: 'hihat-closed', 43: 'tom-lo', 44: 'hihat-closed',
  45: 'tom-lo', 46: 'hihat-open', 47: 'tom-lo', 48: 'tom-hi', 49: 'crash',
  50: 'tom-hi', 51: 'ride', 52: 'crash', 53: 'ride', 54: 'shaker',
  55: 'crash', 56: 'cowbell', 57: 'crash', 58: 'shaker', 59: 'ride',
  60: 'bongo-hi', 61: 'bongo-lo', 62: 'bongo-hi', 63: 'bongo-hi', 64: 'bongo-lo',
  65: 'tom-hi', 66: 'tom-lo', 67: 'cowbell', 68: 'cowbell', 69: 'shaker',
  70: 'shaker', 71: 'woodblock', 72: 'woodblock', 73: 'shaker', 74: 'shaker',
  75: 'woodblock', 76: 'woodblock', 77: 'woodblock', 78: 'bongo-hi', 79: 'bongo-lo',
  80: 'woodblock', 81: 'woodblock',
}

export function gmDrumNoteToType(note) {
  return GM_DRUM_MAP[note] ?? 'kick'
}

export const DRUMS = [
  { id: 'kick',        label: 'Kick',       icon: '🥁', color: '#e05c7a' },
  { id: 'kick-808',    label: 'Kick 808',   icon: '💣', color: '#c43a5a' },
  { id: 'snare',       label: 'Snare',      icon: '🪘', color: '#e08c3a' },
  { id: 'snare-elect', label: 'E. Snare',   icon: '⚡', color: '#c07020' },
  { id: 'hihat-closed',label: 'Hi-Hat',     icon: '🎩', color: '#4ac4c4' },
  { id: 'hihat-open',  label: 'Open Hat',   icon: '🎪', color: '#4a9fd4' },
  { id: 'clap',        label: 'Clap',       icon: '👏', color: '#7c6af7' },
  { id: 'cowbell',     label: 'Cowbell',    icon: '🔔', color: '#d4a843' },
  { id: 'shaker',      label: 'Shaker',     icon: '🎲', color: '#a0c060' },
  { id: 'woodblock',   label: 'Wood Block', icon: '🪵', color: '#a06040' },
  { id: 'tom-hi',      label: 'Tom Hi',     icon: '🔵', color: '#3d9e6e' },
  { id: 'tom-lo',      label: 'Tom Lo',     icon: '🟣', color: '#c45ce0' },
  { id: 'bongo-hi',    label: 'Bongo Hi',   icon: '🟠', color: '#e07840' },
  { id: 'bongo-lo',    label: 'Bongo Lo',   icon: '🔴', color: '#c05030' },
  { id: 'ride',        label: 'Ride',       icon: '✨', color: '#c4b040' },
  { id: 'crash',       label: 'Crash',      icon: '💫', color: '#e0c43a' },
]
