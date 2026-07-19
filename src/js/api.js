// =============================================================================
// api.js — Wrapper das chamadas à API do painel.
//
//   GET /api/mods    -> lista de mods exigidos pelo servidor
//   GET /api/status  -> status do servidor (online/offline, players, versão)
//
// IMPORTANTE: as requisições saem do binário Rust (via reqwest) através dos
// comandos `server_mods` / `server_status`. Antes usávamos `fetch()` da
// webview, que falhava com `load failed` no Tauri/macOS — agora o caminho é o
// mesmo comprovado do `download_mod`. O tratamento de erro (try/catch + card
// vermelho) continua na camada de UI (main.js/ui.js).
// =============================================================================

import { serverMods, serverStatus } from './fs.js';

let BASE_URL = 'https://painel-mc.centralchamados.xyz';

export function setApiBase(url) {
  BASE_URL = url;
}

export function getApiBase() {
  return BASE_URL;
}

// Mensagem amigável exibida ao usuário em caso de falha de rede/timeout.
const CONNECT_ERROR_MSG =
  'Não foi possível conectar no painel-mc. Verifique sua internet.';

// Lista de mods do servidor. O comando Rust retorna um array de
// { file, name, version, description, size } (já desenvelopado de {count, mods}).
export async function fetchServerMods() {
  let data;
  try {
    data = await serverMods();
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    console.error('Falha ao comparar mods:', msg);
    const err = new Error(CONNECT_ERROR_MSG);
    err.cause = msg;
    throw err;
  }
  const mods = Array.isArray(data) ? data : [];
  return mods.map((m) => ({
    file: m.file,
    name: m.name || m.file,
    version: m.version || '',
    description: m.description || '',
    size: m.size || 0,
  }));
}

// Status do servidor. O comando Rust retorna o objeto de status diretamente
// (running, players_online, version, ...). Mapeamos para camelCase na UI.
export async function fetchStatus() {
  let s;
  try {
    s = await serverStatus();
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    console.error('Falha ao obter status:', msg);
    const err = new Error(CONNECT_ERROR_MSG);
    err.cause = msg;
    throw err;
  }
  return {
    running: s.running,
    pid: s.pid,
    version: s.version || '',
    port: s.port,
    publicIp: s.public_ip || '',
    joinLink: s.join_link || '',
    playersOnline: s.players_online || 0,
    playersMax: s.players_max || 0,
    uptimeSeconds: s.uptime_seconds || 0,
    motd: s.motd || '',
    startedAt: s.started_at || '',
  };
}
