import { useState, useEffect, useRef, useCallback } from 'react'
import { AudioPlayer } from './audio/AudioPlayer'
import { BUILTIN_SOUNDS } from './audio/sounds'
import { InstrumentEngine } from './audio/InstrumentEngine'
import { decodeDataUrl, sliceAudioBuffer, analyzeLoudness } from './audio/trim'
import { audioBufferToWav, downloadBlob } from './audio/wav'
import SoundButton from './components/SoundButton'
import PlayerBar from './components/PlayerBar'
import EditModal from './components/EditModal'
import Piano from './components/Piano'
import StepSequencer from './components/StepSequencer'
import './App.css'

const isElectron = !!window.electronAPI
const SLOT_COUNT = 24
const STORAGE_KEY = 'soundboard-slots-v2'
const SCENES_KEY = 'soundboard-scenes-v1'

const player = new AudioPlayer()

function makeDefaultSlots() {
  return Array.from({ length: SLOT_COUNT }, (_, i) => {
    const builtin = BUILTIN_SOUNDS[i]
    if (builtin) {
      return { id: i, label: builtin.label, icon: builtin.icon, builtinId: builtin.id, volume: 1.0, loop: false, hotkey: '', color: null, dataUrl: null }
    }
    return { id: i, label: '', icon: '🔊', builtinId: null, volume: 1.0, loop: false, hotkey: '', color: null, dataUrl: null }
  })
}

function loadSlots() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) return JSON.parse(saved)
  } catch {}
  return makeDefaultSlots()
}

// Scenes: named, saved snapshots of the whole 24-slot soundboard layout —
// "Stream night", "D&D session", "Rage quit pack", whatever — that can be
// swapped in/out instantly without losing the current setup.
function loadScenes() {
  try {
    const saved = localStorage.getItem(SCENES_KEY)
    if (saved) return JSON.parse(saved)
  } catch {}
  return []
}

export default function App() {
  const [slots, setSlots] = useState(loadSlots)
  const [activeSlots, setActiveSlots] = useState(new Set())   // playing or paused
  const [pausedSlots, setPausedSlots] = useState(new Set())   // paused specifically
  const [editingSlot, setEditingSlot] = useState(null)
  const [tab, setTab] = useState('soundboard')
  const [scenes, setScenes] = useState(loadScenes)
  const [sceneMenuOpen, setSceneMenuOpen] = useState(false)
  const sceneMenuRef = useRef(null)
  // Electron's renderer doesn't support window.prompt()/window.confirm()
  // ("Error: prompt() is not supported") — so scenes (and anything else that
  // needs a yes/no or text-entry from the user) go through this in-app dialog
  // instead. `dialog` = { type: 'prompt'|'confirm', message, defaultValue, resolve }
  const [dialog, setDialog] = useState(null)
  const instrumentEngineRef = useRef(null)

  // --- Jam Session recording: capture EVERYTHING playing through the master
  // mix at once — drum loop, piano, and soundboard hits — into one take you
  // can export as a single audio file. Since Piano/Drums/Soundboard already
  // all route through the same `player.masterGain`, no special "routing" is
  // needed; we just tap a MediaStreamAudioDestinationNode off that gain node
  // (in parallel with the normal speaker output) and record that stream.
  const [jamRecording, setJamRecording] = useState(false)
  const [jamElapsed, setJamElapsed] = useState(0)
  const jamDestRef = useRef(null)
  const jamRecorderRef = useRef(null)
  const jamChunksRef = useRef([])
  const jamTimerRef = useRef(null)
  const jamStartRef = useRef(0)
  const [masterVolume, setMasterVolume] = useState(() => parseFloat(localStorage.getItem('ssb-volume') ?? '0.5'))
  const [outputDevices, setOutputDevices] = useState([])
  const [outputDevice, setOutputDevice] = useState(() => localStorage.getItem('ssb-output') ?? 'default')
  const [discordGuideOpen, setDiscordGuideOpen] = useState(false)
  const builtinBuffers = useRef({})

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(slots))
  }, [slots])

  useEffect(() => {
    navigator.mediaDevices.enumerateDevices().then(devs => {
      setOutputDevices(devs.filter(d => d.kind === 'audiooutput'))
    })
  }, [])

  useEffect(() => {
    const initBuffers = async () => {
      await player.init()
      player.setMasterVolume(parseFloat(localStorage.getItem('ssb-volume') ?? '0.5'))
      const savedOutput = localStorage.getItem('ssb-output')
      if (savedOutput && savedOutput !== 'default') player.setOutputDevice(savedOutput)
      for (const sound of BUILTIN_SOUNDS) {
        builtinBuffers.current[sound.id] = sound.generator(player.ctx)
      }
      instrumentEngineRef.current = new InstrumentEngine(player.ctx, player.masterGain)
    }
    initBuffers()
    return () => player.destroy()
  }, [])

  useEffect(() => {
    if (!isElectron) return
    window.electronAPI.onHotkeyFired((slotId) => handlePlay(slots[slotId]))
    return () => window.electronAPI.removeHotkeyListener()
  }, [slots])

  useEffect(() => {
    if (!isElectron) return
    slots.forEach(slot => {
      if (slot.hotkey) window.electronAPI.registerHotkey(slot.id, slot.hotkey)
    })
  }, [slots])

  // Poll for naturally-ended sounds and clean up active state
  useEffect(() => {
    const interval = setInterval(() => {
      setActiveSlots(prev => {
        const next = new Set(prev)
        let changed = false
        for (const id of prev) {
          if (!player.isActive(id)) {
            next.delete(id)
            changed = true
          }
        }
        return changed ? next : prev
      })
      setPausedSlots(prev => {
        const next = new Set(prev)
        let changed = false
        for (const id of prev) {
          if (!player.isActive(id)) {
            next.delete(id)
            changed = true
          }
        }
        return changed ? next : prev
      })
    }, 150)
    return () => clearInterval(interval)
  }, [])

  const handlePlay = useCallback(async (slot) => {
    if (!slot.label && !slot.builtinId && !slot.dataUrl) return
    try {
      await player.init()
      // Honor a saved trim region (set in the sound editor's waveform view) by
      // slicing the decoded buffer down to just that span before playback.
      const trimStart = slot.trimStart ?? 0
      const trimEnd = slot.trimEnd ?? 1
      const hasTrim = trimStart > 0.0001 || trimEnd < 0.9999

      // Apply the auto-normalization gain (computed at import time) on top of
      // the user's chosen slot volume, so imported sounds play at a level
      // consistent with everything else on the board.
      const normGain = (slot.normalizeEnabled !== false) ? (slot.normalizedGain ?? 1) : 1
      const effectiveVolume = Math.max(0, Math.min(2, slot.volume * normGain))

      if (slot.builtinId && builtinBuffers.current[slot.builtinId]) {
        const base = builtinBuffers.current[slot.builtinId]
        const buf = hasTrim ? sliceAudioBuffer(player.ctx, base, trimStart, trimEnd) : base
        await player.playBuffer(slot.id, buf, slot.volume, slot.loop)
      } else if (slot.dataUrl) {
        if (hasTrim) {
          const decoded = await decodeDataUrl(player.ctx, slot.dataUrl)
          const buf = sliceAudioBuffer(player.ctx, decoded, trimStart, trimEnd)
          await player.playBuffer(slot.id, buf, effectiveVolume, slot.loop)
        } else {
          await player.playDataUrl(slot.id, slot.dataUrl, effectiveVolume, slot.loop)
        }
      } else return

      setActiveSlots(prev => new Set([...prev, slot.id]))
      setPausedSlots(prev => { const n = new Set(prev); n.delete(slot.id); return n })
    } catch (e) {
      console.error('Playback error:', e)
    }
  }, [])

  // In-app hotkey fallback for the browser build (Electron already gets
  // system-wide global hotkeys via the listener registered above) — lets
  // quick-fire bindings work whenever the soundboard window has focus,
  // matching the same "Ctrl+Alt+Shift+Key" combo format the Edit modal records.
  useEffect(() => {
    if (isElectron) return
    const onKeyDown = (e) => {
      if (e.repeat) return
      const tag = e.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return
      const parts = []
      if (e.ctrlKey) parts.push('Control')
      if (e.altKey) parts.push('Alt')
      if (e.shiftKey) parts.push('Shift')
      const key = e.key
      if (['Control','Alt','Shift','Meta'].includes(key)) return
      parts.push(key.length === 1 ? key.toUpperCase() : key)
      const combo = parts.join('+')
      const slot = slots.find(s => s.hotkey === combo)
      if (slot) { e.preventDefault(); handlePlay(slot) }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [slots, handlePlay])

  const handlePause = useCallback((slotId) => {
    player.pauseSlot(slotId)
    setPausedSlots(prev => new Set([...prev, slotId]))
  }, [])

  const handleResume = useCallback((slotId) => {
    player.resumeSlot(slotId)
    setPausedSlots(prev => { const n = new Set(prev); n.delete(slotId); return n })
  }, [])

  const handleStop = useCallback((slotId) => {
    player.stopSlot(slotId)
    setActiveSlots(prev => { const n = new Set(prev); n.delete(slotId); return n })
    setPausedSlots(prev => { const n = new Set(prev); n.delete(slotId); return n })
  }, [])

  const handleSeek = useCallback((slotId, seconds) => {
    player.seekSlot(slotId, seconds)
  }, [])

  const stopAll = () => {
    player.stopAll()
    setActiveSlots(new Set())
    setPausedSlots(new Set())
  }

  const handleMasterVolume = (v) => {
    setMasterVolume(v)
    player.setMasterVolume(v)
    localStorage.setItem('ssb-volume', v)
  }

  const handleOutputDevice = async (deviceId) => {
    setOutputDevice(deviceId)
    localStorage.setItem('ssb-output', deviceId)
    await player.setOutputDevice(deviceId)
  }

  const handleSaveSlot = (index, updates) => {
    const isNewAudio = updates.dataUrl && updates.dataUrl !== slots[index]?.dataUrl
    setSlots(prev => {
      const next = [...prev]
      next[index] = { ...next[index], ...updates }
      if (updates.dataUrl) {
        next[index].builtinId = null
        // Reset normalization for newly-loaded audio — the analysis below
        // will fill in the real gain once decoding finishes.
        if (isNewAudio) { next[index].normalizedGain = 1; next[index].normalizeEnabled = true }
      }
      return next
    })
    if (isNewAudio) analyzeAndApplyNormalization(index, updates.dataUrl)
  }

  const handleClearSlot = (index) => {
    handleStop(index)
    if (isElectron) window.electronAPI.unregisterHotkey(index)
    setSlots(prev => {
      const next = [...prev]
      next[index] = { id: index, label: '', icon: '🔊', builtinId: null, volume: 1.0, loop: false, hotkey: '', color: null, dataUrl: null }
      return next
    })
  }

  // Analyze a freshly-imported sound's loudness and store a normalization
  // gain on the slot so it plays back at a level consistent with everything
  // else on the board, regardless of how loud/quiet the source recording was.
  const analyzeAndApplyNormalization = useCallback(async (index, dataUrl) => {
    try {
      await player.init()
      const buf = await decodeDataUrl(player.ctx, dataUrl)
      const { gain } = analyzeLoudness(buf)
      setSlots(prev => {
        const next = [...prev]
        // Bail if the slot moved on (e.g. cleared/replaced) while we decoded
        if (next[index]?.dataUrl !== dataUrl) return prev
        next[index] = { ...next[index], normalizedGain: gain, normalizeEnabled: true }
        return next
      })
    } catch (e) {
      console.warn('Volume normalization analysis failed:', e)
    }
  }, [])

  const handleFileDrop = (index, file) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const dataUrl = e.target.result
      const name = file.name.replace(/\.[^.]+$/, '')
      handleSaveSlot(index, { label: name, dataUrl, builtinId: null, trimStart: 0, trimEnd: 1, normalizedGain: 1, normalizeEnabled: true })
      analyzeAndApplyNormalization(index, dataUrl)
    }
    reader.readAsDataURL(file)
  }

  // --- Jam Session: record the live mixed master output (drums + piano +
  // soundboard, all together, regardless of which tab is active) and export
  // the whole take as one WAV file. ---
  const startJamSession = useCallback(async () => {
    if (jamRecording) return
    try {
      await player.init()
      if (player.ctx.state === 'suspended') await player.ctx.resume()

      // Create the recording tap once and keep it connected — masterGain can
      // fan out to both the speakers (ctx.destination, wired up in init()) and
      // this MediaStreamAudioDestinationNode simultaneously without affecting
      // what you hear.
      if (!jamDestRef.current) {
        jamDestRef.current = player.ctx.createMediaStreamDestination()
        player.masterGain.connect(jamDestRef.current)
      }

      const mimeCandidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']
      const mimeType = mimeCandidates.find(t => window.MediaRecorder?.isTypeSupported?.(t)) || ''

      const recorder = mimeType
        ? new MediaRecorder(jamDestRef.current.stream, { mimeType })
        : new MediaRecorder(jamDestRef.current.stream)

      jamChunksRef.current = []
      recorder.ondataavailable = (e) => { if (e.data && e.data.size) jamChunksRef.current.push(e.data) }
      recorder.onstop = async () => {
        clearInterval(jamTimerRef.current)
        jamTimerRef.current = null
        setJamElapsed(0)
        const recordedType = recorder.mimeType || mimeType || 'audio/webm'
        const blob = new Blob(jamChunksRef.current, { type: recordedType })
        jamChunksRef.current = []
        try {
          // Decode the captured take and re-encode as WAV — a universally
          // playable/editable format, matching the sequencer's pattern export.
          const arrayBuf = await blob.arrayBuffer()
          const decoded = await player.ctx.decodeAudioData(arrayBuf.slice(0))
          const wav = audioBufferToWav(decoded)
          downloadBlob(wav, `samoth-jam-session-${Date.now()}.wav`)
        } catch (err) {
          console.warn('Could not convert jam session recording to WAV, saving raw capture instead:', err)
          const ext = recordedType.includes('ogg') ? 'ogg' : 'webm'
          downloadBlob(blob, `samoth-jam-session-${Date.now()}.${ext}`)
        }
      }

      jamRecorderRef.current = recorder
      jamStartRef.current = performance.now()
      setJamElapsed(0)
      jamTimerRef.current = setInterval(() => {
        setJamElapsed(Math.floor((performance.now() - jamStartRef.current) / 1000))
      }, 250)

      recorder.start()
      setJamRecording(true)
    } catch (err) {
      console.warn('Failed to start jam session recording:', err)
      alert('Could not start recording: ' + err.message)
    }
  }, [jamRecording])

  const stopJamSession = useCallback(() => {
    if (!jamRecording) return
    setJamRecording(false)
    const recorder = jamRecorderRef.current
    if (recorder && recorder.state !== 'inactive') recorder.stop()
  }, [jamRecording])

  useEffect(() => () => {
    // Clean up if the app unmounts mid-recording
    if (jamTimerRef.current) clearInterval(jamTimerRef.current)
    if (jamRecorderRef.current && jamRecorderRef.current.state !== 'inactive') jamRecorderRef.current.stop()
  }, [])

  const fmtJamTime = (s) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`

  // --- Scenes: save/load/delete named layout snapshots ---
  useEffect(() => {
    localStorage.setItem(SCENES_KEY, JSON.stringify(scenes))
  }, [scenes])

  // Close the scene menu on outside click
  useEffect(() => {
    if (!sceneMenuOpen) return
    const onDocClick = (e) => {
      if (sceneMenuRef.current && !sceneMenuRef.current.contains(e.target)) setSceneMenuOpen(false)
    }
    window.addEventListener('mousedown', onDocClick)
    return () => window.removeEventListener('mousedown', onDocClick)
  }, [sceneMenuOpen])

  // In-app replacements for window.prompt()/window.confirm() — Electron's
  // renderer throws "Error: prompt() is not supported" for the native ones.
  const askPrompt = (message, defaultValue = '') =>
    new Promise(resolve => setDialog({ type: 'prompt', message, defaultValue, resolve }))
  const askConfirm = (message, confirmLabel = 'OK') =>
    new Promise(resolve => setDialog({ type: 'confirm', message, confirmLabel, resolve }))

  const saveScene = async () => {
    const name = await askPrompt('Name this scene (e.g. "Stream night", "D&D session"):')
    if (!name || !name.trim()) return
    const scene = { id: `scene_${Date.now()}`, name: name.trim(), slots: JSON.parse(JSON.stringify(slots)) }
    setScenes(prev => [...prev, scene])
    setSceneMenuOpen(false)
  }

  const loadScene = async (scene) => {
    const ok = await askConfirm(`Load scene "${scene.name}"? This replaces your current soundboard layout (it stays saved as its own scene if you saved it first).`, 'Load scene')
    if (!ok) return
    // Unregister old hotkeys before swapping in the new layout
    if (isElectron) slots.forEach((_, i) => window.electronAPI.unregisterHotkey(i))
    stopAll()
    setSlots(scene.slots.map((s, i) => ({ ...s, id: i })))
    setSceneMenuOpen(false)
  }

  const overwriteScene = async (scene) => {
    const ok = await askConfirm(`Overwrite "${scene.name}" with your current layout?`, 'Overwrite')
    if (!ok) return
    setScenes(prev => prev.map(s => s.id === scene.id ? { ...s, slots: JSON.parse(JSON.stringify(slots)) } : s))
  }

  const renameScene = async (scene) => {
    const name = await askPrompt('Rename scene:', scene.name)
    if (!name || !name.trim()) return
    setScenes(prev => prev.map(s => s.id === scene.id ? { ...s, name: name.trim() } : s))
  }

  const deleteScene = async (scene) => {
    const ok = await askConfirm(`Delete scene "${scene.name}"? This cannot be undone.`, 'Delete')
    if (!ok) return
    setScenes(prev => prev.filter(s => s.id !== scene.id))
  }

  return (
    <div className="app">
      <header className="titlebar">
        <div className="titlebar-left">
          <img src="./logo.png" className="app-logo-img" alt="SSB" />
          <span className="app-name">Samoth Soundboard</span>
        </div>
        <div className="titlebar-controls">
          <div className="output-select">
            <label>Output</label>
            <select value={outputDevice} onChange={e => handleOutputDevice(e.target.value)}>
              <option value="default">Default</option>
              {outputDevices.map(d => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || d.deviceId.slice(0, 20)}
                </option>
              ))}
            </select>
          </div>
          <button
            className="discord-guide-btn"
            onClick={() => setDiscordGuideOpen(true)}
            title="Want people in your Discord call to hear your sounds? Click for a step-by-step setup guide"
          >
            🎧 Send to Discord
          </button>
          <div className="vol-control">
            <label>Vol</label>
            <input type="range" min={0} max={1} step={0.01} value={masterVolume}
              onChange={e => handleMasterVolume(parseFloat(e.target.value))} />
            <span>{Math.round(masterVolume * 100)}%</span>
          </div>
          <button className="stop-all-btn" onClick={stopAll}>⏹ Stop All</button>
          <button
            className={`record-btn jam-record-btn ${jamRecording ? 'active' : ''}`}
            onClick={jamRecording ? stopJamSession : startJamSession}
            title={jamRecording
              ? 'Stop the jam session and export everything you played (drums + piano + soundboard, mixed together) as one WAV file'
              : 'Record a full jam session — captures the drum loop, piano, and soundboard hits all mixed together, across every tab, into one exportable file'}
          >
            {jamRecording
              ? <>⏹ Stop &amp; Export Jam <span className="record-indicator">● {fmtJamTime(jamElapsed)}</span></>
              : <>🎙 Record Jam Session</>}
          </button>
          <div className="scene-menu-wrap" ref={sceneMenuRef}>
            <button className="scene-menu-btn" onClick={() => setSceneMenuOpen(v => !v)} title="Save or load named soundboard layouts for different occasions">
              🎬 Scenes{scenes.length ? ` (${scenes.length})` : ''}
            </button>
            {sceneMenuOpen && (
              <div className="scene-menu-popover">
                <button className="scene-menu-save" onClick={saveScene}>💾 Save current layout as scene…</button>
                {scenes.length > 0 && <div className="scene-menu-divider" />}
                {scenes.map(scene => (
                  <div className="scene-menu-item" key={scene.id}>
                    <button className="scene-menu-load" onClick={() => loadScene(scene)} title={`Load "${scene.name}"`}>
                      🎬 {scene.name}
                    </button>
                    <button className="scene-menu-icon-btn" onClick={() => overwriteScene(scene)} title="Overwrite with current layout">⤓</button>
                    <button className="scene-menu-icon-btn" onClick={() => renameScene(scene)} title="Rename">✎</button>
                    <button className="scene-menu-icon-btn danger" onClick={() => deleteScene(scene)} title="Delete">🗑</button>
                  </div>
                ))}
                {!scenes.length && <div className="scene-menu-empty">No saved scenes yet — save your current layout to switch between setups instantly.</div>}
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="tab-bar">
        <button className={`tab-btn ${tab === 'soundboard' ? 'active' : ''}`} onClick={() => setTab('soundboard')}>🔊 Soundboard</button>
        <button className={`tab-btn ${tab === 'piano' ? 'active' : ''}`} onClick={() => setTab('piano')}>🎹 Piano</button>
        <button className={`tab-btn ${tab === 'drums' ? 'active' : ''}`} onClick={() => setTab('drums')}>🥁 Drums</button>
      </div>

      <div className="tab-content">
        <div style={{ display: tab === 'soundboard' ? 'flex' : 'none', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          <div className="grid-container">
            <div className="sound-grid">
              {slots.map((slot, i) => (
                <SoundButton
                  key={slot.id}
                  slot={slot}
                  index={i}
                  active={activeSlots.has(slot.id)}
                  paused={pausedSlots.has(slot.id)}
                  getPosition={() => player.getPosition(slot.id)}
                  getDuration={() => player.getDuration(slot.id)}
                  onPlay={() => handlePlay(slot)}
                  onPause={() => handlePause(slot.id)}
                  onResume={() => handleResume(slot.id)}
                  onStop={() => handleStop(slot.id)}
                  onSeek={(s) => handleSeek(slot.id, s)}
                  onEdit={() => setEditingSlot(i)}
                  onDrop={(file) => handleFileDrop(i, file)}
                />
              ))}
            </div>
          </div>
        </div>
        <div style={{ display: tab === 'piano' ? 'flex' : 'none', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          <Piano engine={instrumentEngineRef.current} />
        </div>
        <div style={{ display: tab === 'drums' ? 'flex' : 'none', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          <StepSequencer ctx={player.ctx} masterGain={player.masterGain} />
        </div>
      </div>

      <PlayerBar
        activeSlots={activeSlots}
        pausedSlots={pausedSlots}
        slots={slots}
        player={player}
        onPause={handlePause}
        onResume={handleResume}
        onStop={handleStop}
        onStopAll={stopAll}
      />

      <footer className="status-bar">
        <span>{activeSlots.size > 0 ? `${activeSlots.size} sound${activeSlots.size > 1 ? 's' : ''} active` : 'Ready'}</span>
        <span className="status-hint">
          {isElectron ? 'Hotkeys work globally' : 'Hotkeys fire while this window is focused — run as the Electron app for global hotkeys'} · Drag & drop audio files onto slots
        </span>
      </footer>

      {editingSlot !== null && (
        <EditModal
          slot={slots[editingSlot]}
          ctx={player.ctx}
          onSave={(updates) => handleSaveSlot(editingSlot, updates)}
          onClear={() => handleClearSlot(editingSlot)}
          onClose={() => setEditingSlot(null)}
        />
      )}

      {dialog && (
        <Dialog
          dialog={dialog}
          onResult={(value) => { dialog.resolve(value); setDialog(null) }}
        />
      )}

      {discordGuideOpen && (
        <DiscordSetupGuide
          outputDevices={outputDevices}
          onClose={() => setDiscordGuideOpen(false)}
        />
      )}
    </div>
  )
}

// Helps people without a hardware mixer (GoXLR, etc.) get the sounds from
// this app, mixed with their own microphone, into a Discord call. Walks
// through installing a free virtual audio mixer (Voicemeeter) and wiring it
// up, since Windows has no built-in way for one app to "speak into" another
// app's microphone input.
const VIRTUAL_DEVICE_HINTS = ['voicemeeter', 'vb-audio', 'cable', 'virtual']

function DiscordSetupGuide({ outputDevices, onClose }) {
  const detected = outputDevices.find(d =>
    VIRTUAL_DEVICE_HINTS.some(hint => (d.label || '').toLowerCase().includes(hint))
  )

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal discord-guide-modal" onClick={e => e.stopPropagation()}>
        <h2>🎧 Send your sounds into Discord</h2>
        <p className="discord-guide-intro">
          Discord can only listen to one microphone at a time, and Windows does not
          let one app "speak into" another app's microphone input directly. People who
          do this (streamers, GoXLR owners, etc.) all rely on the same trick: a free
          virtual audio mixer that combines your microphone and this app's sounds into
          a single virtual input that Discord can pick up. Here's how to set it up,
          it only takes a few minutes and never has to be repeated.
        </p>

        {detected ? (
          <div className="discord-guide-detected">
            ✅ Looks like you already have a virtual audio device installed: <strong>{detected.label}</strong>.
            You can likely skip step 1 below, just select it as your Output here, and
            as your Microphone in Discord.
          </div>
        ) : (
          <div className="discord-guide-missing">
            We didn't detect a virtual audio mixer on your system yet, follow step 1 to install one (it's free).
          </div>
        )}

        <ol className="discord-guide-steps">
          <li>
            <strong>Install Voicemeeter (free)</strong>, a virtual audio mixer that lets
            you combine your mic and app sounds into one input.
            <div>
              <a href="https://vb-audio.com/Voicemeeter/" target="_blank" rel="noopener noreferrer" className="discord-guide-link">
                Download Voicemeeter ↗
              </a>
            </div>
          </li>
          <li>
            <strong>Open Voicemeeter</strong> and route your real microphone into one of
            its input strips (Voicemeeter shows a quick setup guide for this on first launch).
          </li>
          <li>
            <strong>In this app</strong>, set the <em>Output</em> dropdown above to
            <code> Voicemeeter Input (VB-Audio Voicemeeter VAIO)</code>, this sends
            everything you play here into the mixer instead of your speakers.
          </li>
          <li>
            <strong>In Discord</strong>, go to User Settings → Voice &amp; Video → Input Device,
            and select <code>Voicemeeter Output (VB-Audio Voicemeeter VAIO)</code>.
            Discord will now hear your microphone and this app's sounds mixed together.
          </li>
          <li>
            <strong>Tip:</strong> Voicemeeter also lets you keep hearing everything through
            your normal speakers/headset at the same time (set its "Hardware Out" to your
            usual playback device), so you don't lose your own monitoring.
          </li>
        </ol>

        <div className="modal-actions">
          <div style={{ flex: 1 }} />
          <button className="modal-save" onClick={onClose}>Got it</button>
        </div>
      </div>
    </div>
  )
}

// Lightweight in-app prompt/confirm modal — stands in for window.prompt() and
// window.confirm(), since Electron's renderer doesn't implement window.prompt()
// ("Error: prompt() is not supported"). Resolves with the typed string (prompt),
// true/false (confirm), or null on cancel/dismiss.
function Dialog({ dialog, onResult }) {
  const [value, setValue] = useState(dialog.defaultValue || '')
  const isPrompt = dialog.type === 'prompt'

  const submit = () => onResult(isPrompt ? value : true)
  const cancel = () => onResult(isPrompt ? null : false)

  return (
    <div className="modal-overlay" onClick={cancel}>
      <div className="modal dialog-modal" onClick={e => e.stopPropagation()}>
        <p className="dialog-message">{dialog.message}</p>
        {isPrompt && (
          <input
            autoFocus
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') submit()
              if (e.key === 'Escape') cancel()
            }}
          />
        )}
        <div className="modal-actions">
          <div style={{ flex: 1 }} />
          <button className="modal-cancel" onClick={cancel}>Cancel</button>
          <button className="modal-save" onClick={submit} autoFocus={!isPrompt}>
            {dialog.confirmLabel || 'OK'}
          </button>
        </div>
      </div>
    </div>
  )
}
