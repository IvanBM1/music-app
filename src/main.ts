import '@fontsource/roboto/400.css'
import '@fontsource/roboto/500.css'
import './buffer-polyfill'
import './iconv-encodings-polyfill'
import './app.css'
import { isTauri } from '@tauri-apps/api/core'
import { mount } from 'svelte'
import App from './App.svelte'

if (isTauri()) {
  void import('./services/downloads-persistence.service').then((m) => m.loadDownloadsPreferences())
}

const app = mount(App, {
  target: document.getElementById('app')!,
})

export default app
