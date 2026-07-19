import { downloadMod, saveMod } from './fs.js';

function cmpVersion(a, b) {
  const pa = String(a || '').split(/[.\-+]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '').split(/[.\-+]/).map((x) => parseInt(x, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0) ? -1 : 1;
  }
  return String(a || '') === String(b || '') ? 0 : String(a || '') < String(b || '') ? -1 : 1;
}

function modBaseName(value) {
  const base = String(value || '').replace(/\.jar$/i, '');
  const m = base.match(/^(.*?)[-_](?=\d)/);
  return (m ? m[1] : base).trim().toLowerCase();
}

export function compareMods(serverMods, localMods) {
  const localByBase = new Map();
  for (const mod of localMods || []) {
    localByBase.set(modBaseName(mod.name || mod.file), mod);
  }

  return (serverMods || []).map((server) => {
    const local = localByBase.get(modBaseName(server.name || server.file)) || localByBase.get(modBaseName(server.file));
    const state = !local ? 'missing' : cmpVersion(local.version, server.version) < 0 ? 'outdated' : 'ok';
    return {
      file: server.file,
      name: server.name || server.file,
      version: server.version || '',
      description: server.description || '',
      size: server.size || 0,
      localVersion: local ? local.version : '',
      state,
    };
  });
}

export function pendingMods(comparison) {
  return (comparison || []).filter((m) => m.state !== 'ok');
}

export async function downloadPending(dir, mods, onProgress, concurrency = 4) {
  const total = mods.length;
  let done = 0;
  const failed = [];

  for (let i = 0; i < total; i += concurrency) {
    const batch = mods.slice(i, i + concurrency);
    const results = await Promise.allSettled(batch.map(async (mod) => {
      let lastErr;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const bytes = await downloadMod(mod.file);
          if (!bytes || (Array.isArray(bytes) && bytes.length === 0)) throw new Error('arquivo vazio');
          await saveMod(dir, mod.file, bytes);
          return mod;
        } catch (e) {
          lastErr = e;
        }
      }
      throw lastErr;
    }));

    results.forEach((result, idx) => {
      const mod = batch[idx];
      if (result.status === 'fulfilled') done += 1;
      else failed.push({ file: mod.file, error: String(result.reason) });
      if (onProgress) onProgress(done + failed.length, total, mod.file);
    });
  }

  return { downloaded: done, failed };
}
