import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5185,
    strictPort: true
  },
  resolve: {
    alias: {
      'sav-reader': path.resolve(import.meta.dirname, 'node_modules/sav-reader/dist/index.js'),
      'buffer': path.resolve(import.meta.dirname, 'node_modules/buffer/index.js')
    }
  }
})
