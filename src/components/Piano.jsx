import { useEffect, useRef, useState, useCallback } from 'react'
import { ALL_NOTES } from '../audio/InstrumentEngine'
import { MidiPlayer, parseMidiFile, parseTextNoteSheet, looksLikeTextNoteSheet } from '../audio/MidiPlayer'
import { TimidityPlayer } from '../audio/TimidityPlayer'
import { BUILTIN_SONGS } from '../data/builtinSongs'

const isElectron = !!window.electronAPI

// Classic DAW keyboard mapping (FL Studio style)
// Lower octave white: a s d f g h j
// Lower octave black: w e   t y u
// Upper octave white: k l ; '
// Upper octave black: o p
const KEY_MAP_LOW       = { 'a':'C','s':'D','d':'E','f':'F','g':'G','h':'A','j':'B' }
const KEY_MAP_LOW_BLACK  = { 'w':'C#','e':'D#','t':'F#','y':'G#','u':'A#' }
const KEY_MAP_HIGH      = { 'k':'C','l':'D',';':'E',"'":'F' }
const KEY_MAP_HIGH_BLACK = { 'o':'C#','p':'D#' }

const INSTRUMENTS = [
  { id: 'piano',    label: 'Piano',      icon: '🎹' },
  { id: 'epiano',   label: 'E. Piano',   icon: '🎵' },
  { id: 'organ',    label: 'Organ',      icon: '⛪' },
  { id: 'synth',    label: 'Synth',      icon: '🎛' },
  { id: 'fmsynth',  label: 'FM Synth',   icon: '📡' },
  { id: 'lead',     label: 'Lead',       icon: '🎺' },
  { id: 'wobble',   label: 'Wobble',     icon: '🌀' },
  { id: 'bass',     label: 'Bass',       icon: '🎸' },
  { id: 'guitar',   label: 'Guitar',     icon: '🎸' },
  { id: 'banjo',    label: 'Banjo',      icon: '🪕' },
  { id: 'strings',  label: 'Strings',    icon: '🎻' },
  { id: 'violin',   label: 'Violin',     icon: '🎻' },
  { id: 'pad',      label: 'Pad',        icon: '🌊' },
  { id: 'flute',    label: 'Flute',      icon: '🪈' },
  { id: 'ocarina',  label: 'Ocarina',    icon: '🫧' },
  { id: 'trumpet',  label: 'Trumpet',    icon: '🎺' },
  { id: 'accordion',label: 'Accordion',  icon: '🪗' },
  { id: 'saxophone',label: 'Saxophone',  icon: '🎷' },
  { id: 'theremin', label: 'Theremin',   icon: '👻' },
  { id: 'kalimba',  label: 'Kalimba',    icon: '✨' },
  { id: 'musicbox', label: 'Music Box',  icon: '🎀' },
  { id: 'steeldrum',label: 'Steel Drum', icon: '🥁' },
  { id: 'toypiano', label: 'Toy Piano',  icon: '🧸' },
  { id: 'bells',    label: 'Bells',      icon: '🔔' },
  { id: 'marimba',  label: 'Marimba',    icon: '🪵' },
]

const WHITE_SEMITONES = [0,2,4,5,7,9,11] // C D E F G A B
const BLACK_SEMITONES = [1,3,6,8,10]     // C# D# F# G# A#

// Build note lookup: octave+semitone -> note object
const noteByOctaveSemitone = {}
ALL_NOTES.forEach(n => { noteByOctaveSemitone[`${n.octave}_${n.semitone}`] = n })

// Build note lookup: MIDI number -> note object (for chord-mode interval math)
const noteByMidi = {}
ALL_NOTES.forEach(n => { noteByMidi[n.midi] = n })

// Chord-mode: semitone offsets from the root note for each chord type
const CHORD_INTERVALS = {
  major:  [0, 4, 7],
  minor:  [0, 3, 7],
  major7: [0, 4, 7, 11],
  minor7: [0, 3, 7, 10],
  dom7:   [0, 4, 7, 10],
  sus2:   [0, 2, 7],
  sus4:   [0, 5, 7],
  power5: [0, 7],
  dim:    [0, 3, 6],
  aug:    [0, 4, 8],
}
const CHORD_TYPE_OPTIONS = [
  { id: 'major',  label: 'Major' },
  { id: 'minor',  label: 'Minor' },
  { id: 'major7', label: 'Major 7th' },
  { id: 'minor7', label: 'Minor 7th' },
  { id: 'dom7',   label: 'Dominant 7th' },
  { id: 'sus2',   label: 'Sus2' },
  { id: 'sus4',   label: 'Sus4' },
  { id: 'power5', label: 'Power (5th)' },
  { id: 'dim',    label: 'Diminished' },
  { id: 'aug',    label: 'Augmented' },
]

export default function Piano({ engine }) {
  const [activeKeys, setActiveKeys] = useState(new Set())
  const [instrument, setInstrument] = useState('piano')
  const [baseOctave, setBaseOctave] = useState(3)
  const pressedRef = useRef(new Set())
  const mouseDownRef = useRef(false)
  const scrollRef = useRef(null)

  // MIDI player state
  // Two playback engines:
  //  - MidiPlayer: our custom synth-based scheduler (works for both real MIDI
  //    note data AND plain-text note sheets, lights up piano keys as it plays)
  //  - TimidityPlayer: real sampled-instrument playback via WebAssembly +
  //    FreePats GM soundfont (sounds dramatically more realistic, but only
  //    works with real binary .mid files, and can't light up individual keys)
  const midiPlayerRef = useRef(null)
  const timidityPlayerRef = useRef(null)
  const activePlayerRef = useRef('synth') // 'synth' | 'timidity'
  const [midiPlaying, setMidiPlaying] = useState(false)
  const [midiPaused, setMidiPaused] = useState(false)
  const [midiPosition, setMidiPosition] = useState(0)
  const [midiDuration, setMidiDuration] = useState(0)
  const [activeSong, setActiveSong] = useState(null)  // { name, notes, duration }
  const [importedSongs, setImportedSongs] = useState([])
  const midiActiveKeys = useRef(new Set())  // keys lit up by MIDI playback
  const [useRealisticSound, setUseRealisticSound] = useState(true)

  // Sustain pedal: keeps notes ringing after the physical key is released,
  // until the pedal is lifted. Two ways to engage it — hold Spacebar down
  // for momentary "while held" sustain (like a real foot pedal), or click
  // the on-screen pedal button to lock it on persistently until clicked again.
  const [sustain, setSustain] = useState(false)
  const sustainRef = useRef(false)
  const sustainedRef = useRef(new Set()) // note ids currently ringing-via-sustain

  // Chord mode: pressing one key plays a full chord (root + intervals) built
  // from the selected chord type.
  const [chordMode, setChordMode] = useState(false)
  const [chordType, setChordType] = useState('major')
  const chordNoteMapRef = useRef(new Map()) // root note id -> [extra note ids played with it]

  // Recording: capture key presses (note, velocity, timing) into a song that
  // gets saved to the imported-songs library so it can be replayed later.
  const [recording, setRecording] = useState(false)
  const recordingRef = useRef(false)
  const recordedNotesRef = useRef([])           // finished {time, duration, note, vel} entries
  const recordOnsetsRef = useRef(new Map())     // note id -> { startTime, midi, vel } for currently-held notes
  const recordStartRef = useRef(0)

  useEffect(() => {
    if (engine) engine.instrument = instrument
  }, [instrument, engine])

  // Init MIDI player
  useEffect(() => {
    if (!engine) return
    const player = new MidiPlayer(engine)
    player.onNoteOn = (midi) => {
      midiActiveKeys.current.add(midi)
      setActiveKeys(new Set([...midiActiveKeys.current]))
      // Auto-scroll octave to follow melody
      const oct = Math.floor(midi / 12) - 1
      setBaseOctave(Math.max(1, Math.min(6, oct)))
    }
    player.onNoteOff = (midi) => {
      midiActiveKeys.current.delete(midi)
      setActiveKeys(new Set([...midiActiveKeys.current]))
    }
    player.onPositionUpdate = (pos) => setMidiPosition(pos)
    player.onEnd = () => {
      setMidiPlaying(false)
      setMidiPaused(false)
      setMidiPosition(0)
      midiActiveKeys.current.clear()
      setActiveKeys(new Set())
    }
    midiPlayerRef.current = player
    return () => player.stop()
  }, [engine])

  // Init Timidity (real sampled-instrument) player
  useEffect(() => {
    if (!engine) return
    // Pass the shared engine so Timidity reuses its AudioContext + masterGain —
    // this makes the volume slider and chosen output device (setSinkId) work
    // for realistic playback too, instead of Timidity opening its own isolated
    // AudioContext that always plays at full volume on the system default device.
    const player = new TimidityPlayer(engine)
    player.onPositionUpdate = (pos) => setMidiPosition(pos)
    player.onEnd = () => {
      setMidiPlaying(false)
      setMidiPaused(false)
      setMidiPosition(0)
    }
    player.onError = (err) => {
      console.warn('Timidity playback error, falling back to synth playback:', err)
    }
    timidityPlayerRef.current = player
    return () => player.destroy()
  }, [engine])

  // When the user flips "Realistic Sound" while a song is loaded, immediately
  // re-load that song through the newly-selected engine instead of waiting for
  // them to switch songs and back (which is what the user reported happening).
  const prevRealisticRef = useRef(useRealisticSound)
  useEffect(() => {
    if (prevRealisticRef.current === useRealisticSound) return
    prevRealisticRef.current = useRealisticSound
    if (!activeSong) return

    const wasPlaying = midiPlaying
    const wasPaused = midiPaused
    const position = activePlayerRef.current === 'timidity'
      ? (timidityPlayerRef.current?.getPosition() ?? 0)
      : (midiPlayerRef.current?.getPosition?.() ?? 0)

    _stopActivePlayer()

    const useTimidity = useRealisticSound && !!activeSong.midiBuffer
    if (useTimidity) {
      activePlayerRef.current = 'timidity'
      const player = timidityPlayerRef.current
      player.load(activeSong.midiBuffer.slice(0))
      setMidiDuration(activeSong.duration)
      if (position > 0) player.seek(position)
      if (wasPlaying) player.play()
    } else {
      activePlayerRef.current = 'synth'
      const player = midiPlayerRef.current
      if (!player) return
      player.loadNotes(activeSong.notes, activeSong.duration)
      setMidiDuration(activeSong.duration)
      if (position > 0) player.seek(position)
      if (wasPlaying) player.play()
    }

    setMidiPosition(position)
    setMidiPlaying(wasPlaying)
    setMidiPaused(wasPaused)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useRealisticSound])

  const _stopActivePlayer = useCallback(() => {
    if (activePlayerRef.current === 'timidity') timidityPlayerRef.current?.stop()
    else midiPlayerRef.current?.stop()
  }, [])

  const loadSong = useCallback((song) => {
    _stopActivePlayer()
    midiActiveKeys.current.clear()
    setActiveKeys(new Set())

    // Real binary .mid files carry a raw buffer — prefer realistic sampled
    // playback via Timidity for those (when enabled). Plain-text note-sheet
    // imports have no raw MIDI bytes, so they always use our synth scheduler.
    const useTimidity = useRealisticSound && !!song.midiBuffer

    if (useTimidity) {
      activePlayerRef.current = 'timidity'
      const player = timidityPlayerRef.current
      player.load(song.midiBuffer.slice(0)) // slice() so re-loading the same buffer is safe
      setMidiDuration(song.duration)
    } else {
      activePlayerRef.current = 'synth'
      const player = midiPlayerRef.current
      if (!player) return
      player.loadNotes(song.notes, song.duration)
      setMidiDuration(song.duration)
    }

    setActiveSong(song)
    setMidiPosition(0)
    setMidiPlaying(false)
    setMidiPaused(false)
  }, [useRealisticSound, _stopActivePlayer])

  const midiPlay = useCallback(() => {
    if (!activeSong) return
    const player = activePlayerRef.current === 'timidity' ? timidityPlayerRef.current : midiPlayerRef.current
    if (!player) return
    if (midiPaused) { player.resume(); setMidiPaused(false) }
    else { player.play() }
    setMidiPlaying(true)
  }, [activeSong, midiPaused])

  const midiPause = useCallback(() => {
    const player = activePlayerRef.current === 'timidity' ? timidityPlayerRef.current : midiPlayerRef.current
    player?.pause()
    setMidiPlaying(false)
    setMidiPaused(true)
  }, [])

  const midiStop = useCallback(() => {
    _stopActivePlayer()
    setMidiPlaying(false)
    setMidiPaused(false)
    setMidiPosition(0)
    midiActiveKeys.current.clear()
    setActiveKeys(new Set())
  }, [_stopActivePlayer])

  const midiSeek = useCallback((e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientX - rect.left) / rect.width
    const t = ratio * midiDuration
    const player = activePlayerRef.current === 'timidity' ? timidityPlayerRef.current : midiPlayerRef.current
    player?.seek(t)
    setMidiPosition(t)
  }, [midiDuration])

  const importMidi = useCallback(async () => {
    let arrayBuffer
    let name
    if (isElectron && window.electronAPI?.pickAudioFile) {
      // Use a generic file picker - we need MIDI, not audio, so use browser fallback
    }
    // Browser file input — many "MIDI" downloads floating around are actually
    // plain-text note sheets with no/odd extensions, so accept any file and
    // sniff the actual content instead of trusting the extension.
    await new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.onchange = async () => {
        const file = input.files[0]
        if (!file) { resolve(); return }
        name = file.name.replace(/\.[^.]+$/, '')
        arrayBuffer = await file.arrayBuffer()
        resolve()
      }
      input.click()
    })
    if (!arrayBuffer) return
    try {
      const bytes = new Uint8Array(arrayBuffer.slice(0, 4))
      const isRealMidi = bytes[0] === 0x4d && bytes[1] === 0x54 && bytes[2] === 0x68 && bytes[3] === 0x64 // 'MThd'

      let parsed
      if (isRealMidi) {
        parsed = parseMidiFile(arrayBuffer)
      } else {
        // Not a binary MIDI file — try the plain-text "note sheet" format
        // (timestamp_ms + MIDI note numbers per line) used by some virtual-piano downloads
        const text = new TextDecoder('utf-8').decode(arrayBuffer)
        if (looksLikeTextNoteSheet(text)) {
          parsed = parseTextNoteSheet(text)
        } else {
          throw new Error('Unrecognized file format (not a valid MIDI file or note sheet)')
        }
      }

      const { notes, duration } = parsed
      const song = {
        id: `import_${Date.now()}`, name, artist: 'Imported', icon: '📁', notes, duration, bpm: null,
        // Keep the raw bytes for real MIDI files so they can be played back
        // through Timidity's realistic sampled-instrument engine
        midiBuffer: isRealMidi ? arrayBuffer : null,
      }
      setImportedSongs(prev => [...prev, song])
      loadSong(song)
    } catch (e) {
      alert('Could not import file: ' + e.message)
    }
  }, [loadSong])

  // Scroll to show active octave when it changes
  useEffect(() => {
    if (!scrollRef.current) return
    // Each white key is ~36px wide, 7 white keys per octave
    // C1 starts at 0, so baseOctave offset = (baseOctave - 1) * 7 * 36
    const keyWidth = 36
    const targetX = (baseOctave - 1) * 7 * keyWidth - 80
    scrollRef.current.scrollTo({ left: Math.max(0, targetX), behavior: 'smooth' })
  }, [baseOctave])

  // Record the onset of a note (used by the recorder to later compute its
  // start time + held duration once the key is released).
  const recordOnset = useCallback((id, midi, velocity) => {
    if (!recordingRef.current || recordOnsetsRef.current.has(id)) return
    recordOnsetsRef.current.set(id, { startTime: performance.now() / 1000, midi, vel: velocity })
  }, [])

  const pressNote = useCallback((note, velocity = 1) => {
    if (!engine || !note || pressedRef.current.has(note.id)) return
    pressedRef.current.add(note.id)
    engine.volume = 0.7 * velocity
    engine.playNote(note.id, note.freq)
    recordOnset(note.id, note.midi, velocity)
    const newlyActive = [note.id]

    // Chord mode: also fire the extra chord-tone notes alongside the root.
    // We remember which extra notes belong to this root so releaseNote can
    // let go of all of them together (and sustain can hold them together too).
    if (chordMode) {
      const intervals = CHORD_INTERVALS[chordType] || CHORD_INTERVALS.major
      const extras = []
      for (const semi of intervals) {
        if (semi === 0) continue
        const extra = noteByMidi[note.midi + semi]
        if (extra && !pressedRef.current.has(extra.id)) {
          pressedRef.current.add(extra.id)
          engine.playNote(extra.id, extra.freq)
          recordOnset(extra.id, extra.midi, velocity)
          extras.push(extra.id)
          newlyActive.push(extra.id)
        }
      }
      if (extras.length) chordNoteMapRef.current.set(note.id, extras)
    }

    setActiveKeys(prev => new Set([...prev, ...newlyActive]))
  }, [engine, chordMode, chordType, recordOnset])

  // Finish a recorded note: pop its onset and push a finished {time, duration,
  // note, vel} entry (relative to when recording started).
  const finishRecordedNote = useCallback((id) => {
    if (!recordingRef.current) return
    const onset = recordOnsetsRef.current.get(id)
    if (!onset) return
    recordOnsetsRef.current.delete(id)
    recordedNotesRef.current.push({
      time: onset.startTime - recordStartRef.current,
      duration: Math.max(0.05, performance.now() / 1000 - onset.startTime),
      note: onset.midi,
      vel: onset.vel,
    })
  }, [])

  // Shared release logic by note id — used by both releaseNote (keyboard/
  // direct key release) AND the global "stop dragging" mouseup handler below.
  // Centralizing this means BOTH paths correctly respect the sustain pedal
  // and finish the in-progress recording — previously the global mouseup
  // bypassed both via a separate releaseAll() that force-stopped everything,
  // which is why sustain looked broken and recordings of held/dragged notes
  // never completed (and then blocked re-triggering the same key).
  const releaseById = useCallback((id) => {
    if (!engine) return
    const ids = [id, ...(chordNoteMapRef.current.get(id) || [])]
    chordNoteMapRef.current.delete(id)
    ids.forEach(finishRecordedNote)

    if (sustainRef.current) {
      // Keep ringing (and visually lit) until the sustain pedal lifts —
      // just free them up so the same key can be re-struck.
      ids.forEach(i => { pressedRef.current.delete(i); sustainedRef.current.add(i) })
      return
    }

    ids.forEach(i => { pressedRef.current.delete(i); engine.stopNote(i) })
    setActiveKeys(prev => { const n = new Set(prev); ids.forEach(i => n.delete(i)); return n })
  }, [engine, finishRecordedNote])

  const releaseNote = useCallback((note) => {
    if (!note) return
    releaseById(note.id)
  }, [releaseById])

  // Lift the sustain pedal: stop every note that's been ringing past its
  // physical key release and clear the highlight.
  const releaseSustain = useCallback(() => {
    if (!engine) return
    const ids = [...sustainedRef.current]
    if (!ids.length) return
    ids.forEach(id => engine.stopNote(id))
    sustainedRef.current.clear()
    setActiveKeys(prev => { const n = new Set(prev); ids.forEach(id => n.delete(id)); return n })
  }, [engine])

  // "Let go of the mouse while dragging across keys" — release each
  // currently-held note through the normal release path (releaseById) so
  // sustain and recording behave exactly as if each key were lifted
  // individually. NOT a hard panic-stop (that would skip sustain).
  const releaseAllPressed = useCallback(() => {
    for (const id of [...pressedRef.current]) releaseById(id)
  }, [releaseById])

  // Hybrid sustain model: the *effective* pedal state is the OR of two
  // independent sources —
  //   - sustainLockRef: a persistent on/off "lock" toggled by clicking the
  //     on-screen pedal button (stays engaged until clicked again, like
  //     latching a real sustain pedal down with a weight)
  //   - sustainHoldRef: a momentary "while held" state driven by physically
  //     holding the Spacebar down (engages on keydown, lifts on keyup, just
  //     like pressing a foot on a real pedal)
  // Both converge on `sustainRef`/`sustain` (the actual flag everything else
  // checks) via `recomputeSustain`, which we call any time either source
  // changes. We flip refs synchronously (not via a `useEffect` mirror) so
  // there's zero lag between a change and the very next note press/release
  // seeing the right state — a `useEffect`-based mirror can lag a render
  // behind and cause notes to get "stuck on" or fail to sustain depending on
  // timing.
  const sustainLockRef = useRef(false)
  const sustainHoldRef = useRef(false)

  const recomputeSustain = useCallback(() => {
    const next = sustainLockRef.current || sustainHoldRef.current
    if (next === sustainRef.current) return
    sustainRef.current = next
    setSustain(next)
    if (!next) releaseSustain()
  }, [releaseSustain])

  // Click the on-screen pedal — toggles the persistent "lock" on/off
  const toggleSustain = useCallback(() => {
    sustainLockRef.current = !sustainLockRef.current
    recomputeSustain()
  }, [recomputeSustain])

  // Hold the Spacebar — engages the pedal only while it's physically held
  const engageSustainHold = useCallback(() => {
    if (sustainHoldRef.current) return
    sustainHoldRef.current = true
    recomputeSustain()
  }, [recomputeSustain])

  const releaseSustainHold = useCallback(() => {
    if (!sustainHoldRef.current) return
    sustainHoldRef.current = false
    recomputeSustain()
  }, [recomputeSustain])

  // --- Recording: capture your own playing into a song you can replay later ---
  const startRecording = useCallback(() => {
    recordedNotesRef.current = []
    recordOnsetsRef.current.clear()
    recordStartRef.current = performance.now() / 1000
    recordingRef.current = true
    setRecording(true)
  }, [])

  const stopRecording = useCallback(() => {
    recordingRef.current = false
    setRecording(false)

    // Auto-finish any notes that were still being held when recording stopped
    const now = performance.now() / 1000
    for (const [, onset] of recordOnsetsRef.current) {
      recordedNotesRef.current.push({
        time: onset.startTime - recordStartRef.current,
        duration: Math.max(0.05, now - onset.startTime),
        note: onset.midi,
        vel: onset.vel,
      })
    }
    recordOnsetsRef.current.clear()

    const notes = recordedNotesRef.current.slice().sort((a, b) => a.time - b.time)
    if (!notes.length) return

    const duration = Math.max(...notes.map(n => n.time + n.duration))
    const song = {
      id: `recording_${Date.now()}`,
      name: `My Recording ${new Date().toLocaleTimeString()}`,
      artist: 'You',
      icon: '🎤',
      notes,
      duration,
      bpm: null,
      midiBuffer: null,
    }
    setImportedSongs(prev => [...prev, song])
  }, [])

  const toggleRecording = useCallback(() => {
    if (recording) stopRecording()
    else startRecording()
  }, [recording, startRecording, stopRecording])

  // Get note for a keyboard key
  const getNoteForKey = useCallback((key) => {
    const lo = KEY_MAP_LOW[key]
    const loB = KEY_MAP_LOW_BLACK[key]
    const hi = KEY_MAP_HIGH[key]
    const hiB = KEY_MAP_HIGH_BLACK[key]
    if (lo) {
      const semitone = _SEMITONE_OF_NAME(lo)
      return noteByOctaveSemitone[`${baseOctave}_${semitone}`]
    }
    if (loB) {
      const semitone = _SEMITONE_OF_NAME(loB)
      return noteByOctaveSemitone[`${baseOctave}_${semitone}`]
    }
    if (hi) {
      const oct = baseOctave + 1
      const semitone = _SEMITONE_OF_NAME(hi)
      return noteByOctaveSemitone[`${oct}_${semitone}`]
    }
    if (hiB) {
      const oct = baseOctave + 1
      const semitone = _SEMITONE_OF_NAME(hiB)
      return noteByOctaveSemitone[`${oct}_${semitone}`]
    }
    return null
  }, [baseOctave])

  useEffect(() => {
    const onUp = () => { if (mouseDownRef.current) { mouseDownRef.current = false; releaseAllPressed() } }
    window.addEventListener('mouseup', onUp)
    return () => window.removeEventListener('mouseup', onUp)
  }, [releaseAllPressed])

  useEffect(() => {
    const onDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return
      // Sustain pedal: holding Spacebar engages it like a foot on a real
      // pedal — only for as long as it's held down (released on keyup below)
      if (e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault()
        if (!e.repeat) engageSustainHold()
        return
      }
      if (e.repeat) return
      const k = e.key.toLowerCase()
      // Octave shift
      if (k === 'arrowleft' || k === 'arrowdown') { setBaseOctave(o => Math.max(1, o - 1)); return }
      if (k === 'arrowright' || k === 'arrowup')  { setBaseOctave(o => Math.min(6, o + 1)); return }
      const note = getNoteForKey(k)
      if (note) pressNote(note)
    }
    const onUp = (e) => {
      if (e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); releaseSustainHold(); return }
      const k = e.key.toLowerCase()
      const note = getNoteForKey(k)
      if (note) releaseNote(note)
    }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    return () => { window.removeEventListener('keydown', onDown); window.removeEventListener('keyup', onUp) }
  }, [getNoteForKey, pressNote, releaseNote, engageSustainHold, releaseSustainHold])

  // Build the visual keyboard: all octaves C1-C8
  const allOctaves = [1,2,3,4,5,6,7] // C1-C7 (C8 is just one key)
  const keyboardNotes = ALL_NOTES

  // Check if a note is active (from keyboard or MIDI)
  const isNoteActive = (note) => {
    if (activeKeys.has(note.id)) return true
    // Check if MIDI is playing this midi number
    return midiActiveKeys.current.has(note.midi)
  }

  // Get keyboard shortcut label for a note
  const getKeyLabel = (note) => {
    const rel = note.octave - baseOctave
    if (rel === 0) {
      if (!note.black) {
        const name = ['C','D','E','F','G','A','B'][WHITE_SEMITONES.indexOf(note.semitone)]
        const entry = Object.entries(KEY_MAP_LOW).find(([,v]) => v === name)
        return entry ? entry[0].toUpperCase() : null
      } else {
        const name = ['C#','D#','F#','G#','A#'][BLACK_SEMITONES.indexOf(note.semitone)]
        const entry = Object.entries(KEY_MAP_LOW_BLACK).find(([,v]) => v === name)
        return entry ? entry[0].toUpperCase() : null
      }
    }
    if (rel === 1) {
      if (!note.black) {
        const name = ['C','D','E','F','G','A','B'][WHITE_SEMITONES.indexOf(note.semitone)]
        const entry = Object.entries(KEY_MAP_HIGH).find(([,v]) => v === name)
        return entry ? entry[0].toUpperCase() : null
      } else {
        const name = ['C#','D#','F#','G#','A#'][BLACK_SEMITONES.indexOf(note.semitone)]
        const entry = Object.entries(KEY_MAP_HIGH_BLACK).find(([,v]) => v === name)
        return entry ? entry[0].toUpperCase() : null
      }
    }
    return null
  }

  // Render: white keys in a row, black keys absolutely positioned on top
  // For simplicity: render per octave, each octave is a positioned block
  const WHITE_KEY_W = 22
  const WHITE_KEY_H = 80
  const BLACK_KEY_W = 13
  const BLACK_KEY_H = 50

  // Count white keys per octave for offset calculation
  const whiteCountPerOctave = 7
  // C1 starts at index 0
  const totalWhites = allOctaves.length * 7 + 1 // +1 for C8
  const totalWidth = totalWhites * WHITE_KEY_W

  // Build white and black key elements
  const whiteKeys = []
  const blackKeys = []

  ALL_NOTES.forEach(note => {
    if (note.octave < 1 || note.octave > 8) return
    if (note.octave === 8 && note.semitone !== 0) return // only C8

    const octaveOffset = (note.octave - 1) * whiteCountPerOctave
    const keyLabel = getKeyLabel(note)
    const isActive = isNoteActive(note)
    const isInRange = note.octave === baseOctave || note.octave === baseOctave + 1

    if (!note.black) {
      const whiteIdx = WHITE_SEMITONES.indexOf(note.semitone)
      const x = (octaveOffset + whiteIdx) * WHITE_KEY_W
      whiteKeys.push(
        <div
          key={note.id}
          className={`key white-key ${isActive ? 'pressed' : ''} ${isInRange ? 'in-range' : ''}`}
          style={{ left: x, width: WHITE_KEY_W - 2, height: WHITE_KEY_H }}
          onMouseDown={() => { mouseDownRef.current = true; pressNote(note) }}
          onMouseEnter={() => { if (mouseDownRef.current) pressNote(note) }}
          onMouseLeave={() => { if (mouseDownRef.current) releaseNote(note) }}
          onTouchStart={e => { e.preventDefault(); pressNote(note) }}
          onTouchEnd={e => { e.preventDefault(); releaseNote(note) }}
        >
          {note.semitone === 0 && <span className="key-octave">C{note.octave}</span>}
          {keyLabel && <span className="key-shortcut">{keyLabel}</span>}
        </div>
      )
    } else {
      const blackIdx = BLACK_SEMITONES.indexOf(note.semitone)
      // Black key position: between white keys
      // semitone positions: C#=1 (between C=0 and D=1), D#=3, F#=6, G#=8, A#=10
      const blackOffsets = { 1: 0.65, 3: 1.65, 6: 3.65, 8: 4.65, 10: 5.65 }
      const xFrac = blackOffsets[note.semitone]
      if (xFrac === undefined) return
      const x = (octaveOffset + xFrac) * WHITE_KEY_W - 1
      blackKeys.push(
        <div
          key={note.id}
          className={`key black-key ${isActive ? 'pressed' : ''} ${isInRange ? 'in-range' : ''}`}
          style={{ left: x, width: BLACK_KEY_W, height: BLACK_KEY_H }}
          onMouseDown={e => { e.stopPropagation(); mouseDownRef.current = true; pressNote(note) }}
          onMouseEnter={() => { if (mouseDownRef.current) pressNote(note) }}
          onMouseLeave={() => { if (mouseDownRef.current) releaseNote(note) }}
          onTouchStart={e => { e.preventDefault(); pressNote(note) }}
          onTouchEnd={e => { e.preventDefault(); releaseNote(note) }}
        >
          {keyLabel && <span className="key-shortcut black-shortcut">{keyLabel}</span>}
        </div>
      )
    }
  })

  return (
    <div className="piano-wrap">
      <div className="instrument-selector">
        {INSTRUMENTS.map(inst => (
          <button
            key={inst.id}
            className={`inst-btn ${instrument === inst.id ? 'active' : ''}`}
            onClick={() => setInstrument(inst.id)}
          >
            <span>{inst.icon}</span> {inst.label}
          </button>
        ))}
      </div>

      <div className="piano-controls">
        <button className="octave-btn" onClick={() => setBaseOctave(o => Math.max(1, o - 1))} title="Octave down (Arrow Left)">
          ◀ Oct {baseOctave}
        </button>
        <span className="octave-label">C{baseOctave} – B{baseOctave + 1}</span>
        <button className="octave-btn" onClick={() => setBaseOctave(o => Math.min(6, o + 1))} title="Octave up (Arrow Right)">
          Oct {baseOctave + 1} ▶
        </button>

        <button
          className={`sustain-pedal-btn ${sustain ? 'active' : ''}`}
          onClick={toggleSustain}
          title="Click to lock the sustain pedal on (click again to lift it) — or hold Spacebar to sustain only while it's held down, like a real foot pedal"
        >
          🦶 {sustain ? 'Sustain: On' : 'Sustain Pedal: Off'}
        </button>

        <button
          className={`chord-mode-btn ${chordMode ? 'active' : ''}`}
          onClick={() => setChordMode(v => !v)}
          title="Play a full chord from a single key"
        >
          🎼 {chordMode ? 'Chord Mode: On' : 'Chord Mode: Off'}
        </button>
        {chordMode && (
          <select
            className="chord-type-select"
            value={chordType}
            onChange={(e) => setChordType(e.target.value)}
            title="Chord type to play on each key press"
          >
            {CHORD_TYPE_OPTIONS.map(c => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        )}

        <button
          className={`record-btn ${recording ? 'active' : ''}`}
          onClick={toggleRecording}
          title="Record your playing — saved to the Song Library when you stop"
        >
          {recording ? '⏹ Stop Recording' : '⏺ Record'}
        </button>
        {recording && <span className="record-indicator">● Recording your playing…</span>}
      </div>

      <div className="keyboard-scroll" ref={scrollRef}>
        <div className="keyboard-inner" style={{ width: totalWidth, height: WHITE_KEY_H }}>
          {whiteKeys}
          {blackKeys}
        </div>
      </div>

      <div className="piano-hint">
        A-J = current octave · K-' = octave above · Arrow keys shift octave · Drag to glissando · Hold Space to sustain (or click the pedal to lock it on) · Toggle Chord Mode to play chords from one key
      </div>

      <SongLibrary
        songs={[...BUILTIN_SONGS, ...importedSongs]}
        activeSong={activeSong}
        playing={midiPlaying}
        paused={midiPaused}
        position={midiPosition}
        duration={midiDuration}
        onLoad={loadSong}
        onPlay={midiPlay}
        onPause={midiPause}
        onStop={midiStop}
        onSeek={midiSeek}
        onImport={importMidi}
        usingRealSound={activePlayerRef.current === 'timidity'}
        useRealisticSound={useRealisticSound}
        onToggleRealisticSound={() => setUseRealisticSound(v => !v)}
      />

    </div>
  )
}

function fmt(s) {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2,'0')}`
}

function SongLibrary({
  songs, activeSong, playing, paused, position, duration, onLoad, onPlay, onPause, onStop, onSeek, onImport,
  usingRealSound, useRealisticSound, onToggleRealisticSound,
}) {
  return (
    <div className="song-library">
      <div className="song-library-header">
        <span className="song-library-title">🎵 Song Library</span>
        <button
          className={`song-realistic-toggle ${useRealisticSound ? 'active' : ''}`}
          onClick={onToggleRealisticSound}
          title="Play real .mid files with sampled instrument sounds (via Timidity + FreePats) instead of our synth engine"
        >
          {useRealisticSound ? '🎻 Realistic Sound: On' : '🎹 Realistic Sound: Off'}
        </button>
        <button className="song-import-btn" onClick={onImport}>+ Import MIDI</button>
      </div>
      {activeSong && (
        <div className="song-engine-note">
          {usingRealSound
            ? 'Playing with real sampled instruments (Timidity)'
            : 'Playing with synthesized instruments — keys light up as notes play'}
        </div>
      )}

      <div className="song-list">
        {songs.map(song => (
          <button
            key={song.id}
            className={`song-item ${activeSong?.id === song.id ? 'active' : ''}`}
            onClick={() => onLoad(song)}
          >
            <span className="song-icon">{song.icon}</span>
            <div className="song-info">
              <span className="song-name">{song.name}</span>
              <span className="song-artist">{song.artist}</span>
            </div>
            {song.bpm && <span className="song-bpm">{song.bpm} BPM</span>}
          </button>
        ))}
      </div>

      {activeSong && (
        <div className="song-player">
          <div className="song-player-info">
            <span>{activeSong.icon} {activeSong.name}</span>
            <span className="song-time">{fmt(position)} / {fmt(duration)}</span>
          </div>
          <div className="song-progress" onClick={onSeek}>
            <div className="song-progress-fill" style={{ width: `${duration > 0 ? (position / duration) * 100 : 0}%` }} />
          </div>
          <div className="song-player-controls">
            <button className="song-ctrl-btn" onClick={onStop} title="Stop">⏹</button>
            {playing
              ? <button className="song-ctrl-btn play" onClick={onPause}>⏸ Pause</button>
              : <button className="song-ctrl-btn play" onClick={onPlay}>{paused ? '▶ Resume' : '▶ Play'}</button>
            }
          </div>
        </div>
      )}
    </div>
  )
}


// Helper
function _SEMITONE_OF_NAME(name) {
  const map = { 'C':0,'C#':1,'D':2,'D#':3,'E':4,'F':5,'F#':6,'G':7,'G#':8,'A':9,'A#':10,'B':11 }
  return map[name] ?? 0
}
