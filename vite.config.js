import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'

// Serve the Timidity WASM binary + FreePats GM soundfont samples locally
// (both dev server and production build) at /midi-assets/, since the
// timidity player fetches everything relative to one shared base URL.
const midiAssetsPlugin = () => {
  const root = process.cwd()
  const sources = [
    { dir: path.join(root, 'src/audio/timidity-vendor'), files: ['libtimidity.wasm'] },
    { dir: path.join(root, 'node_modules/freepats'), dirs: ['Tone_000', 'Drum_000'] },
  ]

  return {
    name: 'midi-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url.startsWith('/midi-assets/')) return next()
        const rel = req.url.slice('/midi-assets/'.length).split('?')[0]
        for (const src of sources) {
          const filePath = path.join(src.dir, rel)
          if (filePath.startsWith(src.dir) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            res.setHeader('Content-Type', filePath.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream')
            fs.createReadStream(filePath).pipe(res)
            return
          }
        }
        next()
      })
    },
    closeBundle() {
      const outDir = path.join(root, 'dist', 'midi-assets')
      fs.mkdirSync(outDir, { recursive: true })
      // Copy the WASM binary
      fs.copyFileSync(
        path.join(root, 'src/audio/timidity-vendor/libtimidity.wasm'),
        path.join(outDir, 'libtimidity.wasm')
      )
      // Copy the FreePats sample directories
      const freepatsDir = path.join(root, 'node_modules/freepats')
      for (const dirName of ['Tone_000', 'Drum_000']) {
        fs.cpSync(path.join(freepatsDir, dirName), path.join(outDir, dirName), { recursive: true })
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), midiAssetsPlugin()],
  base: './',
  server: { port: 5173 },
  build: { outDir: 'dist', emptyOutDir: true },
})
