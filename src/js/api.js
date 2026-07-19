// =============================================================================
// api.js — Wrapper das chamadas HTTP à API do painel.
//   GET /api/mods    -> lista de mods exigidos pelo servidor
//   GET /api/status  -> status do servidor (online/offline, players, versão)
// =============================================================================

let BASE_URL = 'https://painel-mc.centralchamados.xyz';

export function setApiBase(url) {
  BASE_URL = url;
}

export function getApiBase() {
  return BASE_URL;
}

async function getJson(path) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${path}`);
  return res.json();
}

// Lista de mods do servidor. A rota /api/mods retorna { count, mods: [...] }.
export async function fetchServerMods() {
  const data = await getJson('/api/mods');
  const mods = Array.isArray(data) ? data : data.mods || [];
  return mods.map((m) => ({
    file: m.file,
    name: m.name || m.file,
    version: m.version || '',
    description: m.description || '',
    size: m.size || 0,
  }));
}

// Status do servidor.
export async function fetchStatus() {
  return getJson('/api/status');
}
