// =============================================================================
// mods.js — Lógica de comparação (servidor vs local) e download seletivo.
//
// Fluxo:
//   1. Recebe mods do servidor (serverMods) e mods locais (localMods).
//   2. Para cada mod do servidor, decide o estado:
//        - "missing"   : não existe localmente  -> baixar
//        - "outdated"  : versão local < servidor -> baixar
//        - "ok"        : igual/mais nova         -> nada
//   3. downloadMissing(): baixa só os que precisam, um a um (ou em paralelo
//      limitado), atualizando a barra de progresso via callback.
// =============================================================================

import { downloadMod, saveMod } from './fs.js';

// Comparação de versão simples: tenta semver numérico; se falhar, compara string.
function cmpVersion(a, b) {
  const na = String(a || '');
  const nb = String(b || '');
  const pa = na.split(/[.\-+]/).map((x) => parseInt(x, 10) || 0);
  const pb = nb.split(/[.\-+]/).map((x) => parseInt(x, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  // se numérico empatou, compara string bruta (ex.: "1.0.0" vs "1.0.0-beta")
  if (na === nb) return 0;
  return na < nb ? -1 : 1;
}

// Extrai o "nome base" do mod a partir do filename ou do campo name.
// Como o filename embute a versão (ex.: pingmod-1.0.0.jar), comparamos pelo
// nome base para detectar "outdated" mesmo quando o filename muda de versão.
function modBaseName(nameOrFile) {
  const base = String(nameOrFile || '')
    .replace(/\.jar$/i, '')
    .replace(/\.[Jj][Aa][Rr]$/i, '');
  // corta no último separador antes de dígitos (versão)
  const m = base.match(/^(.*?)[-_](?=\d)/);
  const name = m ? m[1] : base;
  return name.trim().toLowerCase();
}

/**
 * Compara mods do servidor com os locais e retorna a lista enriquecida:
 *   { file, name, version, localVersion, state: 'ok'|'missing'|'outdated' }
 *
 * Correspondência por NOME BASE do mod (não por filename exato), pois o
 * filename inclui a versão. Assim um mod local com versão antiga é reconhecido
 * como "outdated" em vez de "missing". O download sempre usa o filename do
 * servidor (s.file), garantindo pegar a versão certa.
 */
export function compareMods(serverMods, localMods) {
  const localByBase = new Map();
  for (const m of localMods || []) {
    const key = modBaseName(m.name || m.file);
    if (!localByBase.has(key)) localByBase.set(key, m);
  }
  return (serverMods || []).map((s) => {
    const key = modBaseName(s.name || s.file);
    const local = localByBase.get(key) || localByBase.get(modBaseName(s.file));
    let state = 'ok';
    let localVersion = local ? local.version : '';
    if (!local) {
      state = 'missing';
    } else if (cmpVersion(local.version, s.version) < 0) {
      state = 'outdated';
    }
    return {
      file: s.file,
      name: s.name || s.file,
      version: s.version,
      localVersion,
      description: s.description || '',
      size: s.size || 0,
      state,
    };
  });
}

// Retorna só os mods que precisam de download.
export function pendingMods(comparison) {
  return comparison.filter((m) => m.state === 'missing' || m.state === 'outdated');
}

/**
 * Baixa os mods pendentes, gravando cada um na pasta local via comando Rust.
 * @param {string} dir          pasta de mods local
 * @param {Array}  mods         lista de mods pendentes (estado != ok)
 * @param {function} onProgress (done, total, currentFile) -> void
 * @param {number} concurrency  paralelismo (default 4)
 */
export async function downloadPending(dir, mods, onProgress, concurrency = 4) {
  const total = mods.length;
  let done = 0;
  let failed = [];

  // Processa em "pools" de `concurrency` downloads paralelos.
  for (let i = 0; i < total; i += concurrency) {
    const batch = mods.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map(async (m) => {
        // tenta até 2x
        let lastErr;
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const bytes = await downloadMod(m.file);
            if (!bytes || (Array.isArray(bytes) && bytes.length === 0)) {
              throw new Error('arquivo vazio');
            }
            await saveMod(dir, m.file, bytes);
            return m;
          } catch (e) {
            lastErr = e;
          }
        }
        throw lastErr;
      })
    );

    results.forEach((r, idx) => {
      const m = batch[idx];
      if (r.status === 'fulfilled') {
        done++;
      } else {
        failed.push({ file: m.file, error: String(r.reason) });
      }
      if (onProgress) onProgress(done + failed.length, total, m.file);
    });
  }

  return { downloaded: done, failed };
}
