import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { initializeBackend } from './utils/api.ts'
import { invoke } from '@tauri-apps/api/core'
import './index.css'
import './styles.css'
import './model-canvas.css'
import './results.css'


const prepareDesktopPlatform = async () => {
  let platform = 'browser'
  if ('__TAURI_INTERNALS__' in window) {
    try {
      platform = await invoke<string>('desktop_platform')
    } catch {
      platform = navigator.platform.toLowerCase().includes('mac') ? 'macos' : 'other'
    }
  }
  document.documentElement.dataset.desktopPlatform = platform
}

Promise.all([initializeBackend(), prepareDesktopPlatform()]).then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}).catch((error) => {
  document.getElementById('root')!.textContent = `Could not start the Rust backend: ${String(error)}`
})
