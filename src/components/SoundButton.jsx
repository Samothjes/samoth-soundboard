import { useState } from 'react'

const COLORS = [
  '#7c6af7', '#e05c7a', '#3d9e6e', '#e08c3a',
  '#4a9fd4', '#c45ce0', '#e0c43a', '#4ac4c4',
]

export default function SoundButton({
  slot, index, active, paused,
  onPlay, onPause, onResume, onStop, onEdit, onDrop,
}) {
  const color = slot.color || COLORS[index % COLORS.length]
  const [dragOver, setDragOver] = useState(false)

  const handleDragOver = (e) => { e.preventDefault(); setDragOver(true) }
  const handleDragLeave = () => setDragOver(false)
  const handleDrop = (e) => {
    e.preventDefault(); setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file && file.type.startsWith('audio/')) onDrop(file)
  }

  const handleClick = () => {
    if (!slot.label && !slot.builtinId && !slot.dataUrl) return
    if (active && !paused) onPause()
    else if (paused) onResume()
    else onPlay()
  }

  const isEmpty = !slot.label

  return (
    <div
      className={`sound-btn ${active ? 'active' : ''} ${paused ? 'paused' : ''} ${dragOver ? 'drag-over' : ''} ${isEmpty ? 'empty' : ''}`}
      style={{ '--slot-color': color }}
      onClick={handleClick}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      title={isEmpty ? 'Drop audio file or click edit' : slot.label}
    >
      {active && !paused && <div className="playing-ring" />}

      <div className="sound-icon">{slot.icon || '🔊'}</div>
      <div className="sound-name">
        {slot.label || <span className="empty-label">Drop audio here</span>}
      </div>

      {!active && slot.hotkey && (
        <div className="hotkey-badge">{slot.hotkey}</div>
      )}

      {active && !paused && (
        <div className="playing-bar"><span /><span /><span /></div>
      )}

      {paused && <div className="paused-icon">⏸</div>}

      <button
        className="edit-btn"
        onClick={(e) => { e.stopPropagation(); onEdit() }}
        title="Edit"
      >✏️</button>

      {slot.volume !== undefined && slot.volume !== 1 && !active && (
        <div className="vol-badge">{Math.round(slot.volume * 100)}%</div>
      )}
    </div>
  )
}
