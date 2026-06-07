import { useEffect, useRef, useState } from 'react'
import { DRUMS, playDrum } from '../audio/InstrumentEngine'
import { DrumLooper } from '../audio/DrumLooper'

const BPM_OPTIONS = [60, 75, 90, 100, 110, 120, 130, 140, 160, 180]
const BAR_OPTIONS = [1, 2, 4]

export default function DrumPads({ ctx, masterGain }) {
  const [active, setActive] = useState(new Set())
  const [recording, setRecording] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [hasLoop, setHasLoop] = useState(false)
  const [bpm, setBpm] = useState(120)
  const [bars, setBars] = useState(2)
  const [countdown, setCountdown] = useState(null)
  const looperRef = useRef(null)
  const countdownRef = useRef(null)

  useEffect(() => {
    if (!ctx || !masterGain) return
    const looper = new DrumLooper(ctx, masterGain)
    looper.bpm = bpm
    looper.bars = bars
    looper.onUpdate = () => {
      setRecording(looper.recording)
      setPlaying(looper.playing)
      setHasLoop(looper.hits.length > 0)
    }
    looperRef.current = looper
    return () => looper.clear()
  }, [ctx, masterGain])

  useEffect(() => {
    if (looperRef.current) {
      looperRef.current.bpm = bpm
      looperRef.current.bars = bars
    }
  }, [bpm, bars])

  const hit = (drum) => {
    if (!ctx || !masterGain) return
    playDrum(ctx, masterGain, drum.id)
    looperRef.current?.recordHit(drum.id)
    setActive(prev => new Set([...prev, drum.id]))
    setTimeout(() => {
      setActive(prev => { const n = new Set(prev); n.delete(drum.id); return n })
    }, 120)
  }

  useEffect(() => {
    const keyMap = {}
    DRUMS.forEach(d => { keyMap[d.key] = d })
    const onDown = (e) => {
      if (e.repeat || e.target.tagName === 'INPUT') return
      const drum = keyMap[e.key]
      if (drum) hit(drum)
    }
    window.addEventListener('keydown', onDown)
    return () => window.removeEventListener('keydown', onDown)
  }, [ctx, masterGain])

  const handleRecord = () => {
    if (recording) {
      looperRef.current?.stopRecording()
      clearInterval(countdownRef.current)
      setCountdown(null)
      return
    }
    // Countdown from bars * 4 beats
    const loopSecs = (bars * 4 * 60) / bpm
    let elapsed = 0
    setCountdown(loopSecs)
    looperRef.current?.startRecording()
    countdownRef.current = setInterval(() => {
      elapsed += 0.1
      const remaining = loopSecs - elapsed
      if (remaining <= 0) {
        clearInterval(countdownRef.current)
        setCountdown(null)
      } else {
        setCountdown(remaining)
      }
    }, 100)
  }

  const handlePlayStop = () => {
    if (playing) {
      looperRef.current?.stopPlaying()
    } else {
      looperRef.current?.startPlaying()
    }
  }

  const handleClear = () => {
    clearInterval(countdownRef.current)
    setCountdown(null)
    looperRef.current?.clear()
  }

  const loopSecs = (bars * 4 * 60) / bpm

  return (
    <div className="drums-wrap">
      {/* Looper controls */}
      <div className="looper-bar">
        <div className="looper-settings">
          <div className="looper-setting">
            <label>BPM</label>
            <select value={bpm} onChange={e => setBpm(Number(e.target.value))} disabled={recording || playing}>
              {BPM_OPTIONS.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div className="looper-setting">
            <label>Bars</label>
            <select value={bars} onChange={e => setBars(Number(e.target.value))} disabled={recording || playing}>
              {BAR_OPTIONS.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div className="looper-setting">
            <label>Length</label>
            <span className="loop-length">{loopSecs.toFixed(1)}s</span>
          </div>
        </div>

        <div className="looper-controls">
          <button
            className={`loop-btn record-btn ${recording ? 'active' : ''}`}
            onClick={handleRecord}
            title={recording ? 'Stop recording' : 'Record loop'}
          >
            {recording ? '⏹ Stop' : '⏺ Record'}
          </button>

          {hasLoop && !recording && (
            <button
              className={`loop-btn play-btn ${playing ? 'active' : ''}`}
              onClick={handlePlayStop}
            >
              {playing ? '⏸ Pause Loop' : '▶ Play Loop'}
            </button>
          )}

          {hasLoop && (
            <button className="loop-btn clear-btn" onClick={handleClear}>
              🗑 Clear
            </button>
          )}
        </div>

        {recording && countdown !== null && (
          <div className="record-progress">
            <div className="record-bar">
              <div
                className="record-fill"
                style={{ width: `${((loopSecs - countdown) / loopSecs) * 100}%` }}
              />
            </div>
            <span className="record-time">{countdown.toFixed(1)}s left</span>
          </div>
        )}

        {playing && (
          <div className="loop-indicator">
            <span className="loop-dot" /> Loop playing - switch to Piano to jam!
          </div>
        )}
      </div>

      <div className="drum-grid">
        {DRUMS.map(drum => (
          <button
            key={drum.id}
            className={`drum-pad ${active.has(drum.id) ? 'hit' : ''} ${recording ? 'recording-mode' : ''}`}
            style={{ '--drum-color': drum.color }}
            onMouseDown={() => hit(drum)}
            onTouchStart={(e) => { e.preventDefault(); hit(drum) }}
          >
            <span className="drum-icon">{drum.icon}</span>
            <span className="drum-label">{drum.label}</span>
            <span className="drum-key">{drum.key}</span>
          </button>
        ))}
      </div>
      <div className="piano-hint">Press 1-9 to trigger pads</div>
    </div>
  )
}
