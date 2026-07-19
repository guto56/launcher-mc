import { serverMods, serverStatus } from './fs.js';

const CONNECT_ERROR_MSG = 'Não foi possível conectar na API do servidor.';

export async function fetchServerMods() {
  try {
    const data = await serverMods();
    return Array.isArray(data) ? data : [];
  } catch (e) {
    const err = new Error(CONNECT_ERROR_MSG);
    err.cause = e && e.message ? e.message : String(e);
    throw err;
  }
}

export async function fetchStatus() {
  try {
    const s = await serverStatus();
    return {
      running: !!s.running,
      pid: s.pid || 0,
      version: s.version || '',
      port: s.port || 0,
      publicIp: s.public_ip || '',
      joinLink: s.join_link || '',
      playersOnline: s.players_online || 0,
      playersMax: s.players_max || 0,
      uptimeSeconds: s.uptime_seconds || 0,
      motd: s.motd || '',
      startedAt: s.started_at || '',
    };
  } catch (e) {
    const err = new Error(CONNECT_ERROR_MSG);
    err.cause = e && e.message ? e.message : String(e);
    throw err;
  }
}
