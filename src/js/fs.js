// =============================================================================
// fs.js — Ponte entre a UI (web) e os comandos Rust (Tauri).
//
// Em runtime Tauri: usa window.__TAURI__.core.invoke.
// Em dev (navegador comum, rodando `npm run dev`): usa um fallback em memória
// para que seja possível validar o build do frontend sem o binário nativo.
// =============================================================================

// Detecta se estamos dentro do Tauri.
export function isTauri() {
  return typeof window !== 'undefined' && '__TAURI__' in window;
}

// Carrega o invoke do Tauri (v2) sob demanda.
async function invoke(cmd, args) {
  if (isTauri()) {
    const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
    return tauriInvoke(cmd, args);
  }
  // Fallback de desenvolvimento (não-Tauri): usa localStorage + fetch à API real.
  return devInvoke(cmd, args);
}

// ---------- Fallback de desenvolvimento (apenas para testar o build) ----------
// Simula a pasta mods local num diretório virtual em localStorage, mas para a
// listagem/escrita reais depende do binário. Aqui só garantimos que a UI não
// quebra no browser. O caminho reportado é placeholder.
const DEV_DIR_KEY = 'launcher_mc_dev_mods';
function devLocalMods() {
  try {
    return JSON.parse(localStorage.getItem(DEV_DIR_KEY) || '[]');
  } catch {
    return [];
  }
}
async function devInvoke(cmd, args) {
  if (cmd === 'base_url') {
    return window.__LAUNCHER_API_BASE__ || 'http://localhost:8080';
  }
  if (cmd === 'detect_mods_dir') {
    return { path: '(dev) ~/.minecraft/mods', created: false, is_standard: true };
  }
  if (cmd === 'list_local_mods') {
    return devLocalMods().map((m) => ({
      file: m.file,
      name: m.name,
      version: m.version,
      size: m.size || 0,
    }));
  }
  if (cmd === 'save_mod') {
    const local = devLocalMods();
    local.push({ file: args.filename, version: '(local)', size: args.contents?.length || 0 });
    localStorage.setItem(DEV_DIR_KEY, JSON.stringify(local));
    return `(dev) saved ${args.filename}`;
  }
  if (cmd === 'open_minecraft_folder') {
    return;
  }
  if (cmd === 'download_mod') {
    // Em dev, baixa via fetch usando a base_url dev.
    const base = window.__LAUNCHER_API_BASE__ || 'http://localhost:8080';
    const res = await fetch(`${base}/api/mods/file/${encodeURIComponent(args.filename)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    return Array.from(new Uint8Array(buf));
  }
  throw new Error('Comando não suportado em modo dev: ' + cmd);
}

// ---------------------------------------------------------------------------
// API pública usada pelos outros módulos JS.
// ---------------------------------------------------------------------------

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
