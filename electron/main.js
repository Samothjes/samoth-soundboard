import { app, BrowserWindow, ipcMain, globalShortcut, dialog } from 'electron'
import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isDev = !app.isPackaged

let win = null
const registeredHotkeys = new Map()

// Window state persistence
const windowStatePath = path.join(app.getPath('userData'), 'window-state.json')

function loadWindowState() {
  try {
    const data = JSON.parse(fs.readFileSync(windowStatePath, 'utf8'))
    return data
  } catch {
    return null
  }
}

function saveWindowState() {
  if (!win) return
  try {
    const bounds = win.getBounds()
    const maximized = win.isMaximized()
    fs.writeFileSync(windowStatePath, JSON.stringify({ ...bounds, maximized }))
  } catch {}
}

function createWindow() {
  const saved = loadWindowState()

  win = new BrowserWindow({
    width:  saved?.width  ?? 1100,
    height: saved?.height ?? 720,
    x: saved?.x ?? undefined,
    y: saved?.y ?? undefined,
    minWidth: 800,
    minHeight: 500,
    backgroundColor: '#0e1016',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0e1016',
      symbolColor: '#ffffff',
      height: 32,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (saved?.maximized) win.maximize()

  // Save state on move/resize (debounced)
  let saveTimer = null
  const debouncedSave = () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(saveWindowState, 500)
  }
  win.on('resize', debouncedSave)
  win.on('move', debouncedSave)
  win.on('close', saveWindowState)

  if (isDev) {
    win.loadURL('http://localhost:5173')
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll()
  if (process.platform !== 'darwin') app.quit()
})

// Register a global hotkey for a sound slot
ipcMain.handle('register-hotkey', (e, { slotId, accelerator }) => {
  // Unregister old hotkey for this slot if any
  const old = registeredHotkeys.get(slotId)
  if (old) {
    try { globalShortcut.unregister(old) } catch {}
  }

  if (!accelerator) {
    registeredHotkeys.delete(slotId)
    return { ok: true }
  }

  try {
    const ok = globalShortcut.register(accelerator, () => {
      win?.webContents.send('hotkey-fired', slotId)
    })
    if (ok) {
      registeredHotkeys.set(slotId, accelerator)
      return { ok: true }
    } else {
      return { ok: false, error: 'Hotkey already in use' }
    }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('unregister-hotkey', (e, { slotId }) => {
  const acc = registeredHotkeys.get(slotId)
  if (acc) {
    try { globalShortcut.unregister(acc) } catch {}
    registeredHotkeys.delete(slotId)
  }
  return { ok: true }
})

// Open file picker for audio files
ipcMain.handle('pick-audio-file', async () => {
  const result = await dialog.showOpenDialog(win, {
    title: 'Select Audio File',
    filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'flac', 'm4a'] }],
    properties: ['openFile'],
  })
  if (result.canceled || !result.filePaths.length) return null

  const filePath = result.filePaths[0]
  const name = path.basename(filePath, path.extname(filePath))
  // Read file as base64 so renderer can use it
  const data = fs.readFileSync(filePath)
  const ext = path.extname(filePath).slice(1)
  const mimeMap = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac', m4a: 'audio/mp4' }
  const mime = mimeMap[ext] || 'audio/mpeg'
  const dataUrl = `data:${mime};base64,${data.toString('base64')}`
  return { name, dataUrl, filePath }
})
