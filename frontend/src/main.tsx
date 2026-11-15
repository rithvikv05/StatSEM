import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { initializeBackend } from './utils/api.ts'
import { invoke } from '@tauri-apps/api/core'
import './index.css'
import './styles.css'
import './model-canvas.css'
import './results.css'

// The desktop app supplies its own context menus. Suppress the webview's
// browser menu without stopping propagation to the app's menu handlers.
if ('__TAURI_INTERNALS__' in window) {
  document.addEventListener('contextmenu', (event) => event.preventDefault())
}

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
