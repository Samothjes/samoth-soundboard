import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  registerHotkey: (slotId, accelerator) =>
    ipcRenderer.invoke('register-hotkey', { slotId, accelerator }),
  unregisterHotkey: (slotId) =>
    ipcRenderer.invoke('unregister-hotkey', { slotId }),
  pickAudioFile: () =>
    ipcRenderer.invoke('pick-audio-file'),
  onHotkeyFired: (cb) =>
    ipcRenderer.on('hotkey-fired', (e, slotId) => cb(slotId)),
  removeHotkeyListener: () =>
    ipcRenderer.removeAllListeners('hotkey-fired'),
})
