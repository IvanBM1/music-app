import '@fontsource/roboto/400.css'
import '@fontsource/roboto/500.css'
import './buffer-polyfill'
import './iconv-encodings-polyfill'
import './app.css'
import { mount } from 'svelte'
import App from './App.svelte'

const app = mount(App, {
  target: document.getElementById('app')!,
})

export default app
