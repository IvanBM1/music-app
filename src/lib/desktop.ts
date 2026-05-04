import { open } from '@tauri-apps/plugin-dialog'

export async function pickFile() {
  return await open({
    multiple: false
  })
}