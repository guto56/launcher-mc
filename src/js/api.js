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

// Mensagem amigável exibida ao usuário em caso de falha de rede/timeout.
const CONNECT_ERROR_MSG =
  'Não foi possível conectar no painel-mc. Verifique sua internet.';

async function getJson(path) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timeout);
    // Preserva a causa técnica no console para diagnóstico.
    const cause = e && e.name === 'AbortError' ? 'timeout (10s)' : e;
    console.error(`Falha ao buscar ${path}:`, cause);
    // Lança sempre com a mensagem amigável de topo.
    const err = new Error(CONNECT_ERROR_MSG);
    err.cause = cause;
    throw err;
  }

  clearTimeout(timeout);

  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} em ${path}`);
    console.error('Resposta não-OK da API:', err.message);
    const friendly = new Error(CONNECT_ERROR_MSG);
    friendly.cause = err.message;
    throw friendly;
  }
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
