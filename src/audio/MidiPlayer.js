// MIDI playback engine + file parser
import { playDrum, gmProgramToInstrument, gmDrumNoteToType } from './InstrumentEngine'

export class MidiPlayer {
  constructor(engine) {
    this.engine = engine
    this.notes = []
    this.duration = 0
    // When true, route each note through the synth voice mapped from its
    // GM program / channel (so multi-instrument MIDI files sound varied
    // instead of everything playing through one selected instrument).
    this.useGmInstruments = true
    this.playing = false
    this.paused = false
    this._offset = 0       // position when paused
    this._startAt = null   // ctx.currentTime when play() was called
    this._timers = []
    this._activeNoteIds = new Set()
    this.onPositionUpdate = null  // (seconds) => void
    this.onNoteOn = null          // (midiNote) => void
    this.onNoteOff = null         // (midiNote) => void
    this.onEnd = null
    this._rafId = null
  }

  get ctx() { return this.engine?.ctx }

  loadNotes(notes, duration) {
    this.stop()
    this.notes = [...notes].sort((a, b) => a.time - b.time)
    this.duration = duration || (notes.length ? Math.max(...notes.map(n => n.time + n.duration)) : 0)
    this._offset = 0
  }

  play(from = null) {
    if (!this.ctx || !this.notes.length) return
    this.stop(true)

    const startPos = from !== null ? from : this._offset
    this._offset = startPos
    this._startAt = this.ctx.currentTime

    this.playing = true
    this.paused = false

    // Schedule all notes ahead using setTimeout
    this._timers = []
    const now = Date.now()

    this.notes.forEach((note, i) => {
      const noteTime = note.time - startPos
      if (noteTime < -0.05) return  // already passed

      const onDelay = Math.max(0, noteTime * 1000)
      const offDelay = Math.max(0, (noteTime + note.duration) * 1000)
      const id = `midi_${i}`

      const onTimer = setTimeout(() => {
        if (!this.playing) return
        // Scale velocity down to match the baseline used for manual playing
        // (Piano uses `0.7 * velocity`). MIDI files often stack many overlapping
        // notes (chords / multiple tracks) on the same master gain with no
        // limiter, so on top of that we attenuate further based on how many
        // notes are currently sounding to avoid clipping/perceived loudness.
        const polyphony = this._activeNoteIds.size + 1
        const polyScale = 1 / Math.sqrt(Math.min(polyphony, 8))
        const vol = (note.vel ?? 0.8) * 0.45 * polyScale

        if (note.isDrum && this.useGmInstruments) {
          // GM percussion channel — route through the drum synthesizer instead
          // of a pitched instrument, mapped from the GM drum key map
          const drumType = gmDrumNoteToType(note.note)
          this.engine.volume = vol
          playDrum(this.ctx, this.engine.masterGain, drumType, this.ctx.currentTime)
          this._activeNoteIds.add(id) // tracked for polyphony scaling only — drums are one-shot
          this.onNoteOn?.(note.note)
          // Drums are one-shot percussive hits — auto-release shortly after
          setTimeout(() => { this._activeNoteIds.delete(id) }, 120)
          return
        }

        // Only override the instrument when the source data actually carries
        // GM program info (real .mid files). Plain-text note sheets have no
        // instrument data, so they keep playing through whatever the user picked.
        const instrument = (this.useGmInstruments && note.program !== undefined)
          ? gmProgramToInstrument(note.program)
          : null
        this.engine.volume = vol
        this.engine.playNote(id, midiToFreq(note.note), instrument)
        this._activeNoteIds.add(id)
        this.onNoteOn?.(note.note)
      }, onDelay)

      const offTimer = setTimeout(() => {
        if (this._activeNoteIds.has(id)) {
          if (!(note.isDrum && this.useGmInstruments)) this.engine.stopNote(id)
          this._activeNoteIds.delete(id)
          this.onNoteOff?.(note.note)
        }
      }, offDelay)

      this._timers.push(onTimer, offTimer)
    })

    // End timer
    const remaining = (this.duration - startPos) * 1000
    const endTimer = setTimeout(() => {
      this._stopInternal()
      this._offset = 0
      this.onEnd?.()
    }, Math.max(0, remaining))
    this._timers.push(endTimer)

    // RAF loop for position updates
    const tick = () => {
      if (!this.playing) return
      const pos = (this.ctx.currentTime - this._startAt) + this._offset
      this.onPositionUpdate?.(Math.min(pos, this.duration))
      this._rafId = requestAnimationFrame(tick)
    }
    this._rafId = requestAnimationFrame(tick)
  }

  pause() {
    if (!this.playing) return
    this._offset = (this.ctx.currentTime - this._startAt) + this._offset
    this._stopInternal()
    this.paused = true
  }

  resume() {
    if (!this.paused) return
    this.play()
  }

  seek(seconds) {
    const wasPlaying = this.playing
    this._stopInternal()
    this._offset = Math.max(0, Math.min(seconds, this.duration))
    if (wasPlaying) this.play()
  }

  stop(keepOffset = false) {
    this._stopInternal()
    if (!keepOffset) this._offset = 0
    this.paused = false
    this.onPositionUpdate?.(0)
  }

  _stopInternal() {
    this._timers.forEach(t => clearTimeout(t))
    this._timers = []
    cancelAnimationFrame(this._rafId)
    this._activeNoteIds.forEach(id => {
      try { this.engine.stopNote(id) } catch {}
    })
    this._activeNoteIds.clear()
    this.playing = false
  }

  getPosition() {
    if (this.playing) return (this.ctx.currentTime - this._startAt) + this._offset
    return this._offset
  }
}

export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

// ---- MIDI file parser ----
export function parseMidiFile(arrayBuffer) {
  const view = new DataView(arrayBuffer)
  let pos = 0

  const ru32 = () => { const v = view.getUint32(pos); pos += 4; return v }
  const ru16 = () => { const v = view.getUint16(pos); pos += 2; return v }
  const ru8  = () => view.getUint8(pos++)

  const rVarLen = () => {
    let val = 0, b
    do { b = ru8(); val = (val << 7) | (b & 0x7f) } while (b & 0x80)
    return val
  }

  // Header
  if (ru32() !== 0x4d546864) throw new Error('Not a valid MIDI file')
  ru32() // header length (always 6)
  const format = ru16()
  const numTracks = ru16()
  const timeDivision = ru16()

  if (timeDivision & 0x8000) throw new Error('SMPTE time code not supported')

  let tempoChanges = [{ tick: 0, tempo: 500000 }]
  let allNoteEvents = []

  for (let t = 0; t < numTracks; t++) {
    if (pos >= arrayBuffer.byteLength) break
    const chunkType = ru32()
    const chunkLen = ru32()
    const chunkEnd = pos + chunkLen

    if (chunkType !== 0x4d54726b) { pos = chunkEnd; continue } // not MTrk

    let tick = 0
    let running = 0
    const active = {} // `${ch}_${note}` -> {startTick, vel, ch}
    const channelPrograms = {} // channel -> GM program number (updated by 0xCn events)

    while (pos < chunkEnd) {
      tick += rVarLen()
      let byte0 = view.getUint8(pos)

      let status
      if (byte0 & 0x80) { status = byte0; pos++; running = byte0 }
      else { status = running }

      const type = status & 0xf0
      const ch   = status & 0x0f

      if (type === 0x90) {
        const note = ru8(), vel = ru8()
        const key = `${ch}_${note}`
        if (vel > 0) {
          active[key] = { startTick: tick, vel, ch, note, program: channelPrograms[ch] ?? 0 }
        } else {
          if (active[key]) {
            allNoteEvents.push({ ...active[key], note, endTick: tick, track: t })
            delete active[key]
          }
        }
      } else if (type === 0x80) {
        const note = ru8(); ru8()
        const key = `${ch}_${note}`
        if (active[key]) {
          allNoteEvents.push({ ...active[key], note, endTick: tick, track: t })
          delete active[key]
        }
      } else if (type === 0xc0) {
        const program = ru8()
        channelPrograms[ch] = program
      }
      else if (type === 0xa0 || type === 0xb0 || type === 0xe0) { pos += 2 }
      else if (type === 0xd0) { pos += 1 }
      else if (status === 0xff) {
        const meta = ru8(), mlen = rVarLen()
        if (meta === 0x51 && mlen === 3) {
          const a = ru8(), b2 = ru8(), c = ru8()
          tempoChanges.push({ tick, tempo: (a << 16) | (b2 << 8) | c })
        } else { pos += mlen }
      } else if (status === 0xf0 || status === 0xf7) {
        pos += rVarLen()
      } else { pos++ }
    }

    // Close any still-open notes
    for (const data of Object.values(active)) {
      allNoteEvents.push({ ...data, endTick: tick, track: t })
    }

    pos = chunkEnd
  }

  // Sort tempo changes
  tempoChanges.sort((a, b) => a.tick - b.tick)

  function tickToSec(targetTick) {
    let sec = 0, prevTick = 0, prevTempo = 500000
    for (const tc of tempoChanges) {
      if (tc.tick >= targetTick) break
      sec += (tc.tick - prevTick) / timeDivision * (prevTempo / 1_000_000)
      prevTick = tc.tick; prevTempo = tc.tempo
    }
    sec += (targetTick - prevTick) / timeDivision * (prevTempo / 1_000_000)
    return sec
  }

  const notes = allNoteEvents
    .filter(n => n.endTick > n.startTick)
    .map((n, i) => ({
      note: n.note,
      time: tickToSec(n.startTick),
      duration: Math.max(0.04, tickToSec(n.endTick) - tickToSec(n.startTick)),
      vel: n.vel / 127,
      track: n.track,
      channel: n.ch,
      program: n.program,
      isDrum: n.ch === 9, // GM channel 10 (0-indexed 9) is the percussion channel
    }))
    .sort((a, b) => a.time - b.time)

  const duration = notes.length ? Math.max(...notes.map(n => n.time + n.duration)) : 0

  return { notes, duration, format, numTracks }
}

// ---- Plain-text "note sheet" parser ----
// Some "MIDI" downloads floating around (often missing a proper .mid extension)
// are actually simple text dumps used by virtual-piano autoplayer scripts:
//   <timestamp_ms> <note1> [note2] [note3] ...
// Each line is a chord/group of MIDI note numbers fired together at that time.
// There's no explicit note-off/duration — we infer duration from the gap to
// the next distinct timestamp.
export function looksLikeTextNoteSheet(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).slice(0, 8)
  if (lines.length < 2) return false
  return lines.every(line => /^\d+(\s+\d{1,3})+$/.test(line)) &&
    lines.every(line => line.split(/\s+/).slice(1).every(n => +n <= 127))
}

export function parseTextNoteSheet(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  const events = []
  for (const line of lines) {
    const nums = line.split(/\s+/).map(Number)
    if (nums.length < 2 || nums.some(Number.isNaN)) continue
    const [timeMs, ...noteNums] = nums
    const validNotes = noteNums.filter(n => n >= 0 && n <= 127)
    if (!validNotes.length) continue
    events.push({ time: timeMs / 1000, notes: validNotes })
  }
  if (!events.length) throw new Error('No note events found in file')

  events.sort((a, b) => a.time - b.time)

  const notes = []
  for (let i = 0; i < events.length; i++) {
    const ev = events[i]
    // Duration = gap until the next distinct timestamp (clamped to sensible bounds)
    let gap = 0.4
    for (let j = i + 1; j < events.length; j++) {
      if (events[j].time > ev.time) { gap = events[j].time - ev.time; break }
    }
    const duration = Math.min(Math.max(gap * 0.92, 0.05), 2.5)
    for (const n of ev.notes) {
      notes.push({ note: n, time: ev.time, duration, vel: 0.75, track: 0 })
    }
  }

  const duration = notes.length ? Math.max(...notes.map(n => n.time + n.duration)) : 0
  return { notes, duration, format: 0, numTracks: 1 }
}
