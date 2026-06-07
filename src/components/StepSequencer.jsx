import { useEffect, useRef, useState, useCallback } from 'react'
import { DRUMS, playDrum } from '../audio/InstrumentEngine'
import { audioBufferToWav, downloadBlob } from '../audio/wav'

const isElectron = !!window.electronAPI

const DEFAULT_STEPS = 16
const STEP_OPTIONS = [8, 16, 32]

const MAX_STEPS = 32

// Default rows shown on load — a small drum & bass style kit so the preview
// pattern below has something fitting to play with.
const DEFAULT_ROWS = [
  { key: 'row-0', drumId: 'kick', customLabel: null, volume: 1, muted: false, solo: false },
  { key: 'row-1', drumId: 'snare', customLabel: null, volume: 1, muted: false, solo: false },
  { key: 'row-2', drumId: 'hihat-closed', customLabel: null, volume: 0.85, muted: false, solo: false },
  { key: 'row-3', drumId: 'hihat-open', customLabel: null, volume: 0.85, muted: false, solo: false },
  { key: 'row-4', drumId: 'clap', customLabel: null, volume: 1, muted: false, solo: false },
]

// Default BPM — a good pace for drum & bass (typically ~160-180 BPM)
const DEFAULT_BPM = 174
const DEFAULT_SWING = 12 // subtle default groove on the preview pattern

// Step velocity levels a cell can cycle through (right-click on a lit step)
const VELOCITY_NORMAL = 1
const VELOCITY_ACCENT = 1.35
const VELOCITY_GHOST = 0.55
const VELOCITY_CYCLE = [VELOCITY_NORMAL, VELOCITY_ACCENT, VELOCITY_GHOST]

function makeGrid(rowCount) {
  return Array.from({ length: rowCount }, () => Array(MAX_STEPS).fill(false))
}

function makeAccentGrid(rowCount) {
  return Array.from({ length: rowCount }, () => Array(MAX_STEPS).fill(VELOCITY_NORMAL))
}

// Default beat pattern to show on load — a simple drum & bass groove as a preview
function makeDefaultGrid() {
  const grid = makeGrid(DEFAULT_ROWS.length)
  // Kick — syncopated DnB-style hits (1 and the "and" of 3)
  grid[0][0] = true; grid[0][10] = true
  // Snare — classic backbeat on 2 & 4
  grid[1][4] = true; grid[1][12] = true
  // Closed hi-hat — driving 8th-note groove
  ;[0, 2, 4, 6, 8, 10, 12, 14].forEach(s => { grid[2][s] = true })
  // Open hi-hat — accents on the off-beats
  grid[3][6] = true; grid[3][14] = true
  // Clap — layered with the snare for that DnB punch
  grid[4][12] = true
  return grid
}

// Matching default accent/ghost levels — gives the preview pattern some groove
function makeDefaultAccents() {
  const accents = makeAccentGrid(DEFAULT_ROWS.length)
  accents[0][0] = VELOCITY_ACCENT  // emphasize the downbeat kick
  accents[2][2] = VELOCITY_GHOST   // soften a couple of hi-hat off-beats
  accents[2][6] = VELOCITY_GHOST
  accents[2][14] = VELOCITY_GHOST
  return accents
}

// Look up display info (icon/label/color) for a row, falling back to a
// generic "custom sound" appearance for rows that hold an imported sample.
function rowDisplay(row) {
  const drum = row.drumId ? DRUMS.find(d => d.id === row.drumId) : null
  if (drum) return drum
  return { id: row.drumId, label: row.customLabel || 'Custom Sound', icon: '🎵', color: '#9aa0d0' }
}

// Encode a rendered AudioBuffer as a 16-bit PCM WAV Blob (no external deps needed)
// Parse the drag payload set by library items (JSON: { drumId, label, icon, color })
function readDragPayload(e) {
  try {
    const raw = e.dataTransfer.getData('application/json')
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export default function StepSequencer({ ctx, masterGain }) {
  const [steps, setSteps] = useState(DEFAULT_STEPS)
  const [bpm, setBpm] = useState(DEFAULT_BPM)
  const [playing, setPlaying] = useState(false)
  const [currentStep, setCurrentStep] = useState(-1)
  const [rows, setRows] = useState(() => DEFAULT_ROWS.map(r => ({ ...r })))
  const [grid, setGrid] = useState(() => makeDefaultGrid())
  const [accents, setAccents] = useState(() => makeDefaultAccents()) // per-step velocity multiplier (parallel to grid)
  const [swing, setSwing] = useState(DEFAULT_SWING) // 0-75%, delays the off-beat 16ths for groove
  const [patterns, setPatterns] = useState([null, null, null, null])
  const [activePattern, setActivePattern] = useState(0)
  const [confirmClear, setConfirmClear] = useState(false)
  const [dragging, setDragging] = useState(null) // { painting: true/false }
  const [dragOverRow, setDragOverRow] = useState(null) // row index being dragged over (highlight)
  const [dragOverAddZone, setDragOverAddZone] = useState(false)
  const [libraryDragOver, setLibraryDragOver] = useState(false) // true while a row is being dragged over the library (to remove it)
  const [rowMenuOpen, setRowMenuOpen] = useState(null) // row key whose copy/paste/duplicate menu is open
  const [hasRowClipboard, setHasRowClipboard] = useState(false)
  const [hasPatternClipboard, setHasPatternClipboard] = useState(false)
  const [exporting, setExporting] = useState(false)
  const customBuffers = useRef({}) // rowKey -> AudioBuffer
  const rowKeyCounter = useRef(DEFAULT_ROWS.length)
  const rowClipboard = useRef(null) // copied row: { drumId, customLabel, gridRow, accentRow, volume, muted, solo, buffer }
  const patternClipboard = useRef(null) // copied whole pattern: { rows, grid, accents, steps, bpm, swing, buffers }

  const schedulerRef = useRef(null)
  const ctxRef = useRef(ctx)
  const masterGainRef = useRef(masterGain)
  const gridRef = useRef(grid)
  const accentsRef = useRef(accents)
  const rowsRef = useRef(rows)
  const swingRef = useRef(swing)
  const bpmRef = useRef(bpm)
  const stepsRef = useRef(steps)
  const currentStepRef = useRef(0)
  const nextStepTimeRef = useRef(0)
  const scheduledSteps = useRef([]) // { step, time } for visual sync
  const rafRef = useRef(null)

  useEffect(() => { gridRef.current = grid }, [grid])
  useEffect(() => { accentsRef.current = accents }, [accents])
  useEffect(() => { rowsRef.current = rows }, [rows])
  useEffect(() => { swingRef.current = swing }, [swing])
  useEffect(() => { bpmRef.current = bpm }, [bpm])
  useEffect(() => { stepsRef.current = steps }, [steps])
  useEffect(() => { ctxRef.current = ctx }, [ctx])
  useEffect(() => { masterGainRef.current = masterGain }, [masterGain])

  // Plays a drum hit scaled by an extra gain multiplier (row volume × step
  // velocity/accent) without having to touch InstrumentEngine's playDrum —
  // we just route through a throwaway gain node when scaling is needed.
  const playScaledDrum = (c, mg, drumId, time, customBuffer, scale) => {
    if (scale === 1) {
      playDrum(c, mg, drumId, time, customBuffer)
      return
    }
    const scaleGain = c.createGain()
    scaleGain.gain.value = Math.max(0, scale)
    scaleGain.connect(mg)
    playDrum(c, scaleGain, drumId, time, customBuffer)
  }

  const scheduleStep = useCallback((step, time) => {
    const g = gridRef.current
    const acc = accentsRef.current
    const mg = masterGainRef.current
    const c = ctxRef.current
    const rs = rowsRef.current
    if (!c || !mg) return
    const anySolo = rs.some(r => r.solo)
    rs.forEach((row, i) => {
      if (!g[i]?.[step]) return
      const audible = anySolo ? row.solo : !row.muted
      if (!audible) return
      const velocity = acc[i]?.[step] ?? VELOCITY_NORMAL
      const scale = (row.volume ?? 1) * velocity
      playScaledDrum(c, mg, row.drumId, time, customBuffers.current[row.key] || null, scale)
    })
    scheduledSteps.current.push({ step, time })
  }, [])

  const runScheduler = useCallback(() => {
    const c = ctxRef.current
    if (!c) return
    const stepDuration = 60 / bpmRef.current / 4 // 16th notes
    const lookahead = 0.1
    // Swing delays the "off-beat" 16ths (odd steps) for a more human groove
    const swingDelay = stepDuration * 0.5 * (swingRef.current / 100)

    while (nextStepTimeRef.current < c.currentTime + lookahead) {
      const step = currentStepRef.current
      const scheduledTime = nextStepTimeRef.current + (step % 2 === 1 ? swingDelay : 0)
      scheduleStep(step, scheduledTime)
      nextStepTimeRef.current += stepDuration
      currentStepRef.current = (step + 1) % stepsRef.current
    }
  }, [scheduleStep])

  // Visual sync via RAF
  useEffect(() => {
    if (!playing) {
      cancelAnimationFrame(rafRef.current)
      return
    }
    const tick = () => {
      const c = ctxRef.current
      if (c) {
        const now = c.currentTime
        // Find last scheduled step that has passed
        const passed = scheduledSteps.current.filter(s => s.time <= now)
        if (passed.length > 0) {
          setCurrentStep(passed[passed.length - 1].step)
          // Trim queue
          scheduledSteps.current = scheduledSteps.current.filter(s => s.time > now - 0.2)
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [playing])

  const startPlaying = () => {
    if (!ctx) return
    currentStepRef.current = 0
    nextStepTimeRef.current = ctx.currentTime + 0.05
    scheduledSteps.current = []
    setPlaying(true)
    schedulerRef.current = setInterval(runScheduler, 25)
  }

  const stopPlaying = () => {
    clearInterval(schedulerRef.current)
    setPlaying(false)
    setCurrentStep(-1)
    scheduledSteps.current = []
  }

  const togglePlay = () => playing ? stopPlaying() : startPlaying()

  // When steps change, just update the count - grid data is always MAX_STEPS
  const handleStepsChange = (newSteps) => {
    setSteps(newSteps)
    if (playing) {
      currentStepRef.current = 0
      nextStepTimeRef.current = ctx.currentTime + 0.05
    }
  }

  const toggleCell = (rowIdx, stepIdx, value) => {
    setGrid(prev => {
      const next = prev.map(r => [...r])
      next[rowIdx][stepIdx] = value
      return next
    })
    if (!value) {
      // Reset velocity back to normal when a step is switched off, so it
      // doesn't silently come back as an accent/ghost next time it's lit
      setAccents(prev => {
        const next = prev.map(r => [...r])
        next[rowIdx][stepIdx] = VELOCITY_NORMAL
        return next
      })
    }
  }

  // Right-click a lit step to cycle its velocity: normal -> accent -> ghost -> normal.
  // Right-clicking an unlit step turns it on as an accent straight away.
  const cycleStepVelocity = (rowIdx, stepIdx) => {
    const isOn = grid[rowIdx]?.[stepIdx]
    if (!isOn) {
      toggleCell(rowIdx, stepIdx, true)
      setAccents(prev => {
        const next = prev.map(r => [...r])
        next[rowIdx][stepIdx] = VELOCITY_ACCENT
        return next
      })
      return
    }
    setAccents(prev => {
      const next = prev.map(r => [...r])
      const cur = next[rowIdx][stepIdx] ?? VELOCITY_NORMAL
      const idx = VELOCITY_CYCLE.indexOf(cur)
      next[rowIdx][stepIdx] = VELOCITY_CYCLE[(idx + 1) % VELOCITY_CYCLE.length]
      return next
    })
  }

  const clearRow = (rowIdx) => {
    setGrid(prev => {
      const next = prev.map(r => [...r])
      next[rowIdx] = Array(MAX_STEPS).fill(false)
      return next
    })
    setAccents(prev => {
      const next = prev.map(r => [...r])
      next[rowIdx] = Array(MAX_STEPS).fill(VELOCITY_NORMAL)
      return next
    })
  }

  const clearAll = () => {
    setGrid(makeGrid(rows.length))
    setAccents(makeAccentGrid(rows.length))
    setConfirmClear(false)
  }

  const setRowVolume = (rowIdx, vol) => {
    setRows(prev => {
      const next = [...prev]
      next[rowIdx] = { ...next[rowIdx], volume: vol }
      return next
    })
  }

  const toggleRowMute = (rowIdx) => {
    setRows(prev => {
      const next = [...prev]
      next[rowIdx] = { ...next[rowIdx], muted: !next[rowIdx].muted }
      return next
    })
  }

  const toggleRowSolo = (rowIdx) => {
    setRows(prev => {
      const next = [...prev]
      next[rowIdx] = { ...next[rowIdx], solo: !next[rowIdx].solo }
      return next
    })
  }

  // Pattern save/load - auto-saves current before switching
  const switchPattern = (slot) => {
    if (slot === activePattern) return
    // Auto-save current pattern (including row/instrument layout)
    setPatterns(prev => {
      const next = [...prev]
      next[activePattern] = {
        grid: grid.map(r => [...r]),
        accents: accents.map(r => [...r]),
        rows: rows.map(r => ({ ...r })),
        steps,
        bpm,
        swing,
      }
      const target = next[slot]
      if (target) {
        const restoredRows = target.rows ? target.rows.map(r => ({ ...r })) : DEFAULT_ROWS.map(r => ({ ...r }))
        setRows(restoredRows)
        setGrid(target.grid)
        setAccents(target.accents || makeAccentGrid(restoredRows.length))
        setSteps(target.steps)
        setBpm(target.bpm)
        setSwing(target.swing ?? 0)
        if (playing) {
          currentStepRef.current = 0
          nextStepTimeRef.current = ctx?.currentTime + 0.05 || 0
        }
      } else {
        // Empty slot - start fresh with the default kit
        setRows(DEFAULT_ROWS.map(r => ({ ...r })))
        setGrid(makeDefaultGrid())
        setAccents(makeDefaultAccents())
        setSwing(DEFAULT_SWING)
      }
      return next
    })
    setActivePattern(slot)
  }

  // Drag to paint
  const handleMouseDown = (rowIdx, stepIdx) => {
    const newVal = !grid[rowIdx][stepIdx]
    setDragging({ painting: newVal })
    toggleCell(rowIdx, stepIdx, newVal)
  }

  const handleMouseEnter = (rowIdx, stepIdx) => {
    if (dragging === null) return
    toggleCell(rowIdx, stepIdx, dragging.painting)
  }

  useEffect(() => {
    const up = () => setDragging(null)
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [])

  // Manual pad hit
  const hitPad = (row) => {
    if (!ctx || !masterGain) return
    playDrum(ctx, masterGain, row.drumId, null, customBuffers.current[row.key] || null)
  }

  // --- Library drag & drop: assign instruments to rows / create new rows ---

  const assignInstrumentToRow = (rowIdx, drumId, label) => {
    setRows(prev => {
      const next = [...prev]
      const row = next[rowIdx]
      delete customBuffers.current[row.key]
      next[rowIdx] = { ...row, drumId, customLabel: null }
      return next
    })
    void label // (kept for clarity — DRUMS lookup supplies the label/icon/color)
  }

  const addRow = (drumId) => {
    const key = `row-${rowKeyCounter.current++}`
    setRows(prev => [...prev, { key, drumId, customLabel: null, volume: 1, muted: false, solo: false }])
    setGrid(prev => [...prev, Array(MAX_STEPS).fill(false)])
    setAccents(prev => [...prev, Array(MAX_STEPS).fill(VELOCITY_NORMAL)])
  }

  // Remove a row entirely (its grid data, accents + custom buffer go with it)
  const removeRowByKey = (key) => {
    const idx = rows.findIndex(r => r.key === key)
    if (idx === -1) return
    setRows(prev => prev.filter((_, i) => i !== idx))
    setGrid(prev => prev.filter((_, i) => i !== idx))
    setAccents(prev => prev.filter((_, i) => i !== idx))
    delete customBuffers.current[key]
  }

  // --- Row copy / paste / duplicate (via the row's "⋮" menu) ---

  const copyRow = (row, idx) => {
    rowClipboard.current = {
      drumId: row.drumId,
      customLabel: row.customLabel,
      gridRow: [...(grid[idx] || Array(MAX_STEPS).fill(false))],
      accentRow: [...(accents[idx] || Array(MAX_STEPS).fill(VELOCITY_NORMAL))],
      volume: row.volume ?? 1,
      muted: row.muted ?? false,
      solo: row.solo ?? false,
      buffer: customBuffers.current[row.key] || null,
    }
    setHasRowClipboard(true)
    setRowMenuOpen(null)
  }

  const pasteRow = (row, idx) => {
    const c = rowClipboard.current
    if (!c) return
    setRows(prev => {
      const next = [...prev]
      next[idx] = { ...next[idx], drumId: c.drumId, customLabel: c.customLabel, volume: c.volume, muted: c.muted, solo: c.solo }
      return next
    })
    setGrid(prev => {
      const next = prev.map(r => [...r])
      next[idx] = [...c.gridRow]
      return next
    })
    setAccents(prev => {
      const next = prev.map(r => [...r])
      next[idx] = [...c.accentRow]
      return next
    })
    if (c.buffer) customBuffers.current[row.key] = c.buffer
    else delete customBuffers.current[row.key]
    setRowMenuOpen(null)
  }

  const duplicateRow = (row, idx) => {
    const key = `row-${rowKeyCounter.current++}`
    const gridRow = [...(grid[idx] || Array(MAX_STEPS).fill(false))]
    const accentRow = [...(accents[idx] || Array(MAX_STEPS).fill(VELOCITY_NORMAL))]
    const buffer = customBuffers.current[row.key] || null
    if (buffer) customBuffers.current[key] = buffer
    setRows(prev => {
      const next = [...prev]
      next.splice(idx + 1, 0, {
        key, drumId: row.drumId, customLabel: row.customLabel,
        volume: row.volume ?? 1, muted: row.muted ?? false, solo: row.solo ?? false,
      })
      return next
    })
    setGrid(prev => {
      const next = prev.map(r => [...r])
      next.splice(idx + 1, 0, gridRow)
      return next
    })
    setAccents(prev => {
      const next = prev.map(r => [...r])
      next.splice(idx + 1, 0, accentRow)
      return next
    })
    setRowMenuOpen(null)
  }

  // Close any open row menu when clicking elsewhere
  useEffect(() => {
    if (!rowMenuOpen) return
    const close = () => setRowMenuOpen(null)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [rowMenuOpen])

  // --- Whole-pattern copy / paste (independent of the numbered pattern slots —
  // a quick way to grab everything and drop it onto another slot) ---

  const copyPattern = () => {
    patternClipboard.current = {
      rows: rows.map(r => ({ ...r })),
      grid: grid.map(r => [...r]),
      accents: accents.map(r => [...r]),
      steps, bpm, swing,
      buffers: { ...customBuffers.current },
    }
    setHasPatternClipboard(true)
  }

  const pastePattern = () => {
    const c = patternClipboard.current
    if (!c) return
    setRows(c.rows.map(r => ({ ...r })))
    setGrid(c.grid.map(r => [...r]))
    setAccents(c.accents.map(r => [...r]))
    setSteps(c.steps)
    setBpm(c.bpm)
    setSwing(c.swing)
    customBuffers.current = { ...c.buffers }
    if (playing) {
      currentStepRef.current = 0
      nextStepTimeRef.current = ctx?.currentTime + 0.05 || 0
    }
  }

  // Library item drags use 'application/json' (drumId payload); row drags use
  // a distinct 'application/x-seq-row' type so drop targets can tell them apart
  // without needing to read getData() during dragover (browsers restrict that).
  const isLibraryDrag = (e) => e.dataTransfer.types.includes('application/json')
  const isRowDrag = (e) => e.dataTransfer.types.includes('application/x-seq-row')

  const handleRowDragOver = (e, rowIdx) => {
    if (!isLibraryDrag(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragOverRow(rowIdx)
  }

  const handleRowDrop = (e, rowIdx) => {
    if (!isLibraryDrag(e)) return
    e.preventDefault()
    setDragOverRow(null)
    const data = readDragPayload(e)
    if (data?.drumId) assignInstrumentToRow(rowIdx, data.drumId, data.label)
  }

  const handleAddZoneDragOver = (e) => {
    if (!isLibraryDrag(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragOverAddZone(true)
  }

  const handleAddZoneDrop = (e) => {
    if (!isLibraryDrag(e)) return
    e.preventDefault()
    setDragOverAddZone(false)
    const data = readDragPayload(e)
    if (data?.drumId) addRow(data.drumId)
  }

  const handleLibraryDragStart = (e, drum) => {
    e.dataTransfer.effectAllowed = 'copy'
    e.dataTransfer.setData('application/json', JSON.stringify({
      drumId: drum.id, label: drum.label, icon: drum.icon, color: drum.color,
    }))
  }

  // Pick up a row from the grid — drag it back onto the library to delete it
  const handleRowPadDragStart = (e, row) => {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('application/x-seq-row', row.key)
  }

  const handleLibraryDragOver = (e) => {
    if (!isRowDrag(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setLibraryDragOver(true)
  }

  const handleLibraryDragLeave = (e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return
    setLibraryDragOver(false)
  }

  const handleLibraryDrop = (e) => {
    if (!isRowDrag(e)) return
    e.preventDefault()
    setLibraryDragOver(false)
    const key = e.dataTransfer.getData('application/x-seq-row')
    if (key) removeRowByKey(key)
  }

  // Load custom sample for an existing row (replaces that row's sound)
  const loadCustomSample = async (row, idx) => {
    const apply = (audioBuf, label) => {
      customBuffers.current[row.key] = audioBuf
      setRows(prev => {
        const next = [...prev]
        next[idx] = { ...next[idx], customLabel: label }
        return next
      })
    }
    if (isElectron && window.electronAPI?.pickAudioFile) {
      const result = await window.electronAPI.pickAudioFile()
      if (!result) return
      // result is a dataUrl
      const res = await fetch(result)
      const arrayBuf = await res.arrayBuffer()
      const audioBuf = await ctx.decodeAudioData(arrayBuf)
      apply(audioBuf, '★ custom')
    } else {
      // Browser file input fallback
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'audio/*'
      input.onchange = async () => {
        const file = input.files[0]
        if (!file) return
        const arrayBuf = await file.arrayBuffer()
        const audioBuf = await ctx.decodeAudioData(arrayBuf)
        const name = file.name.replace(/\.[^.]+$/, '').slice(0, 10)
        apply(audioBuf, name)
      }
      input.click()
    }
  }

  const clearCustomSample = (row, idx) => {
    delete customBuffers.current[row.key]
    if (!row.drumId) {
      // This row only ever existed because of the custom sample (added via
      // "+ Add Custom Sound") — with the sample gone there's nothing left to
      // play, so remove the row entirely rather than falling back to some
      // arbitrary default sound.
      removeRowByKey(row.key)
    } else {
      // This row started as a built-in drum and had a custom sample layered
      // on top — just drop the sample and revert to that original sound.
      setRows(prev => {
        const next = [...prev]
        next[idx] = { ...next[idx], customLabel: null }
        return next
      })
    }
  }

  // Add a brand-new custom-sound row underneath the existing rows (from the library panel)
  const addCustomSoundRow = async () => {
    if (!ctx) return
    const finish = (audioBuf, label) => {
      const key = `row-${rowKeyCounter.current++}`
      customBuffers.current[key] = audioBuf
      setRows(prev => [...prev, { key, drumId: null, customLabel: label, volume: 1, muted: false, solo: false }])
      setGrid(prev => [...prev, Array(MAX_STEPS).fill(false)])
      setAccents(prev => [...prev, Array(MAX_STEPS).fill(VELOCITY_NORMAL)])
    }
    if (isElectron && window.electronAPI?.pickAudioFile) {
      const result = await window.electronAPI.pickAudioFile()
      if (!result) return
      const res = await fetch(result)
      const arrayBuf = await res.arrayBuffer()
      const audioBuf = await ctx.decodeAudioData(arrayBuf)
      finish(audioBuf, '★ custom')
    } else {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'audio/*'
      input.onchange = async () => {
        const file = input.files[0]
        if (!file) return
        const arrayBuf = await file.arrayBuffer()
        const audioBuf = await ctx.decodeAudioData(arrayBuf)
        const name = file.name.replace(/\.[^.]+$/, '').slice(0, 10)
        finish(audioBuf, name)
      }
      input.click()
    }
  }

  // Render the current pattern loop offline (OfflineAudioContext) and download it as a WAV
  const exportToWav = async () => {
    if (!ctx || exporting) return
    const OfflineCtor = window.OfflineAudioContext || window.webkitOfflineAudioContext
    if (!OfflineCtor) {
      alert('Offline rendering is not supported in this environment.')
      return
    }
    setExporting(true)
    try {
      const sampleRate = ctx.sampleRate
      const stepDur = 60 / bpm / 4
      const swingDelay = stepDur * 0.5 * (swing / 100)
      const loopDur = stepDur * steps
      const tail = 1.5 // let decaying hits (crash, open hat, custom samples...) ring out past the loop end
      const totalFrames = Math.ceil(sampleRate * (loopDur + tail))
      const offlineCtx = new OfflineCtor(2, totalFrames, sampleRate)
      const offlineGain = offlineCtx.createGain()
      offlineGain.gain.value = 1
      offlineGain.connect(offlineCtx.destination)

      const anySolo = rows.some(r => r.solo)
      for (let step = 0; step < steps; step++) {
        const time = step * stepDur + (step % 2 === 1 ? swingDelay : 0)
        rows.forEach((row, i) => {
          if (!grid[i]?.[step]) return
          const audible = anySolo ? row.solo : !row.muted
          if (!audible) return
          const velocity = accents[i]?.[step] ?? VELOCITY_NORMAL
          const scale = (row.volume ?? 1) * velocity
          const buf = customBuffers.current[row.key] || null
          if (scale === 1) {
            playDrum(offlineCtx, offlineGain, row.drumId, time, buf)
          } else {
            const g = offlineCtx.createGain()
            g.gain.value = Math.max(0, scale)
            g.connect(offlineGain)
            playDrum(offlineCtx, g, row.drumId, time, buf)
          }
        })
      }

      const rendered = await offlineCtx.startRendering()
      const blob = audioBufferToWav(rendered)
      downloadBlob(blob, `samoth-beat-${bpm}bpm-${Date.now()}.wav`)
    } catch (err) {
      console.warn('Failed to export pattern to WAV:', err)
      alert('Could not export the pattern: ' + err.message)
    } finally {
      setExporting(false)
    }
  }

  const stepDuration = 60 / bpm / 4
  const loopLength = stepDuration * steps

  return (
    <div className="sequencer-shell">

      {/* Instrument library — drag items onto a row to assign, or onto the
          "+ new row" zone at the bottom of the grid to add a fresh row */}
      <div
        className={`seq-library ${libraryDragOver ? 'remove-target' : ''}`}
        onDragOver={handleLibraryDragOver}
        onDragLeave={handleLibraryDragLeave}
        onDrop={handleLibraryDrop}
      >
        {libraryDragOver && (
          <div className="seq-library-remove-overlay">
            <span className="seq-library-remove-icon">🗑</span>
            <span>Drop here to remove from your kit</span>
          </div>
        )}
        <div className="seq-library-title">Instruments</div>
        <div className="seq-library-hint">Drag onto a row to swap its sound, drop below the grid to add a new row, or drag a row back here to remove it</div>
        <div className="seq-library-list">
          {DRUMS.map(drum => (
            <div
              key={drum.id}
              className="seq-library-item"
              style={{ '--drum-color': drum.color }}
              draggable
              onDragStart={(e) => handleLibraryDragStart(e, drum)}
              onMouseDown={() => playDrum(ctx, masterGain, drum.id, null)}
              title={`Drag "${drum.label}" onto a row, or click to preview`}
            >
              <span className="seq-lib-icon">{drum.icon}</span>
              <span className="seq-lib-name">{drum.label}</span>
            </div>
          ))}
        </div>
        <button className="seq-library-custom-btn" onClick={addCustomSoundRow} title="Import an audio file as a brand-new row">
          + Add Custom Sound
        </button>
      </div>

      <div className="sequencer-wrap">

        {/* Transport */}
        <div className="transport">
          <button className={`transport-play ${playing ? 'active' : ''}`} onClick={togglePlay}>
            {playing ? '⏹ Stop' : '▶ Play'}
          </button>

          <div className="transport-bpm">
            <label>BPM</label>
            <input
              type="range" min={60} max={200} step={1} value={bpm}
              onChange={e => setBpm(Number(e.target.value))}
            />
            <span>{bpm}</span>
          </div>

          <div className="transport-bpm transport-swing">
            <label>Swing</label>
            <input
              type="range" min={0} max={75} step={1} value={swing}
              onChange={e => setSwing(Number(e.target.value))}
              title="Delays the off-beat 16th notes for a looser, more human groove"
            />
            <span>{swing}%</span>
          </div>

          <div className="transport-steps">
            <label>Steps</label>
            {STEP_OPTIONS.map(s => (
              <button
                key={s}
                className={`steps-btn ${steps === s ? 'active' : ''}`}
                onClick={() => handleStepsChange(s)}
              >{s}</button>
            ))}
          </div>

          <div className="transport-info">
            {loopLength.toFixed(1)}s loop
          </div>

          <div className="transport-pattern-clipboard">
            <button className="pattern-clip-btn" onClick={copyPattern} title="Copy the entire current pattern (rows, beats, BPM, swing) to the clipboard">
              ⧉ Copy
            </button>
            <button className="pattern-clip-btn" onClick={pastePattern} disabled={!hasPatternClipboard} title="Paste the copied pattern over the current one">
              📋 Paste
            </button>
            <button className="pattern-clip-btn export-wav-btn" onClick={exportToWav} disabled={exporting} title="Render this pattern's loop and download it as a WAV file">
              {exporting ? '⏳ Rendering…' : '⬇ Export WAV'}
            </button>
          </div>

          {confirmClear ? (
            <div className="confirm-clear">
              <span>Sure?</span>
              <button className="confirm-yes" onClick={clearAll}>Yes</button>
              <button className="confirm-no" onClick={() => setConfirmClear(false)}>No</button>
            </div>
          ) : (
            <button className="clear-all-btn" onClick={() => setConfirmClear(true)}>Clear All</button>
          )}
        </div>

        {/* Patterns */}
        <div className="pattern-row">
          <span className="pattern-label">Patterns</span>
          {patterns.map((p, i) => (
            <button
              key={i}
              className={`pattern-slot-btn ${activePattern === i ? 'active' : ''} ${p || activePattern === i ? 'has-data' : ''}`}
              onClick={() => switchPattern(i)}
              title={activePattern === i ? 'Current pattern' : p ? `Switch to pattern ${i + 1}` : `Empty slot ${i + 1}`}
            >
              {i + 1}
              <span className="pattern-dot">{activePattern === i || p ? '●' : '○'}</span>
            </button>
          ))}
        </div>

        {/* Step grid */}
        <div className="step-grid" onMouseLeave={() => setDragging(null)}>

          {/* Step numbers header */}
          <div className="grid-header">
            <div className="row-label" />
            <div className="steps-header">
              {Array.from({ length: steps }, (_, i) => (
                <div
                  key={i}
                  className={`step-num ${currentStep === i ? 'current' : ''} ${i % 4 === 0 ? 'beat' : ''}`}
                >
                  {i % 4 === 0 ? Math.floor(i / 4) + 1 : ''}
                </div>
              ))}
            </div>
          </div>

          {rows.map((row, di) => {
            const display = rowDisplay(row)
            return (
              <div
                key={row.key}
                className={`grid-row ${dragOverRow === di ? 'drag-over' : ''}`}
              >
                {/* Instrument label / pad — also a drop target for swapping the sound */}
                <div
                  className="row-label"
                  onDragOver={(e) => handleRowDragOver(e, di)}
                  onDragLeave={() => setDragOverRow(prev => prev === di ? null : prev)}
                  onDrop={(e) => handleRowDrop(e, di)}
                >
                  <button
                    className="row-pad"
                    style={{ '--drum-color': display.color }}
                    draggable
                    onDragStart={(e) => handleRowPadDragStart(e, row)}
                    onMouseDown={() => hitPad(row)}
                    title={`Click to hit ${display.label} · drag onto another instrument to swap its sound · drag back onto the library to remove`}
                  >
                    <span className="row-pad-icon">{display.icon}</span>
                    <span className="row-pad-name">{row.customLabel || display.label}</span>
                  </button>
                  <input
                    type="range"
                    className="row-volume"
                    min={0} max={1} step={0.01}
                    value={row.volume ?? 1}
                    onChange={(e) => setRowVolume(di, Number(e.target.value))}
                    style={{ '--drum-color': display.color }}
                    title={`Row volume: ${Math.round((row.volume ?? 1) * 100)}%`}
                  />
                  <button
                    className={`row-mute-btn ${row.muted ? 'active' : ''}`}
                    onClick={() => toggleRowMute(di)}
                    title={row.muted ? 'Unmute this row' : 'Mute this row'}
                  >M</button>
                  <button
                    className={`row-solo-btn ${row.solo ? 'active' : ''}`}
                    onClick={() => toggleRowSolo(di)}
                    title={row.solo ? 'Unsolo this row' : 'Solo this row (mutes all other rows)'}
                  >S</button>
                  <button
                    className={`row-sample-btn ${customBuffers.current[row.key] ? 'has-sample' : ''}`}
                    onClick={() => customBuffers.current[row.key] ? clearCustomSample(row, di) : loadCustomSample(row, di)}
                    title={customBuffers.current[row.key] ? 'Remove custom sample' : 'Load custom sample for this row'}
                  >{customBuffers.current[row.key] ? '★' : '+'}</button>
                  <button className="row-clear" onClick={() => clearRow(di)} title="Clear row">✕</button>
                  <div className="row-menu-wrap">
                    <button
                      className="row-menu-btn"
                      onClick={(e) => { e.stopPropagation(); setRowMenuOpen(prev => prev === row.key ? null : row.key) }}
                      title="Copy, paste or duplicate this row"
                    >⋮</button>
                    {rowMenuOpen === row.key && (
                      <div className="row-menu-popover" onMouseDown={(e) => e.stopPropagation()}>
                        <button onClick={() => copyRow(row, di)}>⧉ Copy row</button>
                        <button onClick={() => pasteRow(row, di)} disabled={!hasRowClipboard}>📋 Paste row</button>
                        <button onClick={() => duplicateRow(row, di)}>⎘ Duplicate row</button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Steps */}
                <div className="steps-row">
                  {Array.from({ length: steps }, (_, si) => {
                    const on = !!grid[di]?.[si]
                    const velocity = accents[di]?.[si] ?? VELOCITY_NORMAL
                    return (
                      <div
                        key={si}
                        className={[
                          'step-cell',
                          on ? 'on' : '',
                          on && velocity > VELOCITY_NORMAL ? 'accent-hit' : '',
                          on && velocity < VELOCITY_NORMAL ? 'ghost-hit' : '',
                          currentStep === si ? 'playhead' : '',
                          si % 4 === 0 ? 'beat-start' : '',
                        ].join(' ')}
                        style={{ '--drum-color': display.color }}
                        onMouseDown={() => handleMouseDown(di, si)}
                        onMouseEnter={() => handleMouseEnter(di, si)}
                        onContextMenu={(e) => { e.preventDefault(); cycleStepVelocity(di, si) }}
                        title="Click to toggle · right-click to cycle accent / normal / ghost velocity"
                      />
                    )
                  })}
                </div>
              </div>
            )
          })}

          {/* Drop zone for adding a brand new row by dragging an instrument here */}
          <div
            className={`grid-row add-row-zone ${dragOverAddZone ? 'drag-over' : ''}`}
            onDragOver={handleAddZoneDragOver}
            onDragLeave={() => setDragOverAddZone(false)}
            onDrop={handleAddZoneDrop}
          >
            <div className="row-label add-row-label">+ drop here for a new row</div>
            <div className="add-row-track" />
          </div>
        </div>

        <div className="seq-hint">Click or drag to paint beats · Right-click a step to cycle accent/ghost velocity · M/S to mute or solo a row · Drag instruments from the library onto rows</div>
      </div>
    </div>
  )
}
