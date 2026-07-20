import { toast } from './ui.js';

async function invoke(cmd, args) {
  const globalInvoke = globalThis.__TAURI__?.core?.invoke;
  if (globalInvoke) return globalInvoke(cmd, args);

  try {
    const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
    return await tauriInvoke(cmd, args);
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    console.error(`Falha ao chamar comando Tauri "${cmd}":`, e);
    toast(`Erro no Tauri (${cmd}): ${msg}`, 'err');
    throw e;
  }
}

export async function detectModsDir() {
  return invoke('detect_mods_dir');
}

export async function listLocalMods(dir) {
  return invoke('list_local_mods', { dir });
}

export async function saveMod(dir, filename, bytes) {
  return invoke('save_mod', { dir, filename, contents: bytes });
}

export async function openMinecraftFolder(path) {
  return invoke('open_minecraft_folder', { path });
}

export async function downloadMod(filename) {
  return invoke('download_mod', { filename });
}

export async function getBaseUrl() {
  return invoke('base_url');
}

export async function serverMods() {
  return invoke('server_mods');
}

export async function serverStatus() {
  return invoke('server_status');
}

export async function ensureForge(version) {
  return invoke('ensure_forge', { version });
}

export async function launchMinecraft(profile) {
  return invoke('launch_minecraft', { profile });
}
