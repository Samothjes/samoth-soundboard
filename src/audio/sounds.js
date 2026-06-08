// Generate funny built-in sounds using Web Audio API
// Returns an AudioBuffer

export function generateAirhorn(ctx) {
  const duration = 1.2
  const buf = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) {
    const t = i / ctx.sampleRate
    const env = Math.min(1, t * 10) * Math.pow(1 - t / duration, 0.3)
    const freq = 440 + 180 * Math.sin(t * 3)
    data[i] = env * (
      0.5 * Math.sin(2 * Math.PI * freq * t) +
      0.3 * Math.sin(2 * Math.PI * freq * 2 * t) +
      0.2 * Math.sin(2 * Math.PI * freq * 3 * t)
    )
  }
  return buf
}

export function generateVineBoom(ctx) {
  const duration = 1.5
  const buf = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) {
    const t = i / ctx.sampleRate
    const freq = 60 * Math.pow(0.1, t * 1.5)
    const env = Math.pow(1 - t / duration, 2)
    data[i] = env * Math.sin(2 * Math.PI * freq * t)
  }
  return buf
}

export function generateFart(ctx) {
  const duration = 0.6
  const buf = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate)
  const data = buf.getChannelData(0)
  let phase = 0
  for (let i = 0; i < data.length; i++) {
    const t = i / ctx.sampleRate
    const env = Math.pow(1 - t / duration, 1.5) * Math.min(1, t * 20)
    const freq = 80 + 40 * Math.sin(t * 25) + 20 * Math.sin(t * 67)
    phase += (2 * Math.PI * freq) / ctx.sampleRate
    const noise = (Math.random() * 2 - 1) * 0.3
    data[i] = env * (Math.sin(phase) * 0.7 + noise)
  }
  return buf
}

export function generateSadTrombone(ctx) {
  const duration = 2.0
  const buf = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate)
  const data = buf.getChannelData(0)
  // Four descending notes
  const notes = [466, 415, 370, 311]
  const noteDur = duration / notes.length
  for (let i = 0; i < data.length; i++) {
    const t = i / ctx.sampleRate
    const noteIdx = Math.min(notes.length - 1, Math.floor(t / noteDur))
    const noteT = t - noteIdx * noteDur
    const env = Math.min(1, noteT * 15) * Math.pow(1 - noteT / noteDur, 0.3)
    const freq = notes[noteIdx]
    data[i] = env * 0.6 * (
      Math.sin(2 * Math.PI * freq * t) +
      0.3 * Math.sin(2 * Math.PI * freq * 2 * t)
    )
  }
  return buf
}

export function generateRimshot(ctx) {
  const duration = 0.5
  const buf = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) {
    const t = i / ctx.sampleRate
    // Snare hit
    const snareEnv = Math.pow(1 - t / 0.15, 3) * (t < 0.15 ? 1 : 0)
    const snare = snareEnv * ((Math.random() * 2 - 1) * 0.8 + Math.sin(2 * Math.PI * 180 * t) * 0.4)
    // Hihat after
    const hihatEnv = t > 0.1 ? Math.pow(1 - (t - 0.1) / 0.4, 2) : 0
    const hihat = hihatEnv * (Math.random() * 2 - 1) * 0.3
    data[i] = snare + hihat
  }
  return buf
}

export function generateOof(ctx) {
  const duration = 0.4
  const buf = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) {
    const t = i / ctx.sampleRate
    const env = Math.min(1, t * 30) * Math.pow(1 - t / duration, 1.2)
    const freq = 300 - 150 * (t / duration)
    data[i] = env * 0.8 * Math.sin(2 * Math.PI * freq * t)
  }
  return buf
}

export function generateAlarm(ctx) {
  const duration = 1.5
  const buf = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) {
    const t = i / ctx.sampleRate
    const beep = Math.floor(t * 4) % 2 === 0
    const freq = beep ? 880 : 660
    data[i] = beep ? 0.5 * Math.sin(2 * Math.PI * freq * t) : 0
  }
  return buf
}

export function generateWow(ctx) {
  const duration = 1.0
  const buf = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate)
  const data = buf.getChannelData(0)
  let phase = 0
  for (let i = 0; i < data.length; i++) {
    const t = i / ctx.sampleRate
    const env = Math.min(1, t * 8) * Math.pow(1 - t / duration, 0.5)
    const freq = 200 + 600 * Math.pow(t / duration, 2) * Math.sin(t * 2)
    phase += (2 * Math.PI * freq) / ctx.sampleRate
    data[i] = env * 0.6 * Math.sin(phase)
  }
  return buf
}

export function generateWrongBuzzer(ctx) {
  // Classic game-show "ehhhh" wrong-answer buzzer: a harsh, sustained low buzz
  const duration = 1.1
  const buf = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate)
  const data = buf.getChannelData(0)
  const freq = 110
  const detune = 6 // slightly detuned second oscillator creates the "buzzy" beating
  for (let i = 0; i < data.length; i++) {
    const t = i / ctx.sampleRate
    const env = Math.min(1, t * 30) * Math.pow(1 - t / duration, 0.25)
    const wave = (
      Math.sin(2 * Math.PI * freq * t) +
      Math.sin(2 * Math.PI * (freq + detune) * t) +
      0.5 * Math.sin(2 * Math.PI * freq * 2 * t) +
      0.3 * Math.sin(2 * Math.PI * freq * 3 * t)
    )
    data[i] = env * 0.35 * wave
  }
  return buf
}

export function generateCorrectDing(ctx) {
  // Cheerful ascending bell chime for a correct/good answer ("ding ding ding!")
  const duration = 1.0
  const buf = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate)
  const data = buf.getChannelData(0)
  const notes = [523.25, 659.25, 783.99] // C5, E5, G5 — major chord arpeggio
  const noteSpacing = 0.13
  for (let i = 0; i < data.length; i++) {
    const t = i / ctx.sampleRate
    let sample = 0
    notes.forEach((freq, idx) => {
      const nt = t - idx * noteSpacing
      if (nt < 0) return
      const env = Math.min(1, nt * 40) * Math.exp(-nt * 4)
      sample += env * 0.45 * (
        Math.sin(2 * Math.PI * freq * nt) +
        0.4 * Math.sin(2 * Math.PI * freq * 2 * nt) +
        0.15 * Math.sin(2 * Math.PI * freq * 3 * nt)
      )
    })
    data[i] = sample
  }
  return buf
}

export const BUILTIN_SOUNDS = [
  { id: 'airhorn',     label: 'Airhorn',      icon: '📯', generator: generateAirhorn },
  { id: 'vineboom',    label: 'Vine Boom',    icon: '💥', generator: generateVineBoom },
  { id: 'fart',        label: 'Fart',         icon: '💨', generator: generateFart },
  { id: 'sadtrombone', label: 'Sad Trombone', icon: '🎺', generator: generateSadTrombone },
  { id: 'rimshot',     label: 'Rimshot',      icon: '🥁', generator: generateRimshot },
  { id: 'oof',         label: 'Oof',          icon: '😬', generator: generateOof },
  { id: 'alarm',       label: 'Alarm',        icon: '🚨', generator: generateAlarm },
  { id: 'wow',         label: 'Wow',          icon: '😮', generator: generateWow },
  { id: 'wronganswer', label: 'Wrong Answer', icon: '❌', generator: generateWrongBuzzer },
  { id: 'correctanswer', label: 'Correct!',   icon: '✅', generator: generateCorrectDing },
]
