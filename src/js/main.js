// =============================================================================
// main.js — Bootstrap do Launcher MC.
// Orquestra: detectar pasta -> listar local -> buscar servidor -> comparar ->
// renderizar -> (botão) baixar seletivo -> progresso -> toast.
// =============================================================================

import { detectModsDir, listLocalMods, openMinecraftFolder, getBaseUrl } from './fs.js';
import { fetchServerMods, fetchStatus, setApiBase } from './api.js';
import { compareMods, pendingMods, downloadPending } from './mods.js';
import {
  setStatus,
  setModsDir,
  renderMods,
  setDiffSummary,
  setInstallEnabled,
  showProgress,
  setProgress,
  toast,
  observeReveals,
} from './ui.js';

// Estado global da sessão.
const state = {
  dir: null,
  comparison: [],
};

async function refreshStatus() {
  try {
    const s = await fetchStatus();
    setStatus(s.running, s.playersOnline);
  } catch (e) {
    setStatus(false, null);
  }
}

async function loadAndCompare() {
  if (!state.dir) return;
  try {
    const [serverMods, localMods] = await Promise.all([
      fetchServerMods(),
      listLocalMods(state.dir),
    ]);
    state.comparison = compareMods(serverMods, localMods);
    renderMods(state.comparison);
    const pending = pendingMods(state.comparison);
    setDiffSummary(pending.length, state.comparison.length);
    // Rótulo do botão muda conforme há algo a atualizar.
    if (pending.length === 0) {
      setInstallEnabled(state.comparison.length > 0, 'Tudo em dia');
    } else {
      const hasMissing = pending.some((m) => m.state === 'missing');
      setInstallEnabled(true, hasMissing ? 'Instalar tudo' : 'Atualizar');
    }
  } catch (e) {
    toast('Falha ao comparar mods: ' + e.message, 'err');
  }
}

async function init() {
  // Ajusta a base da API conforme o comando Rust (ou env no dev).
  try {
    const base = await getBaseUrl();
    if (base) setApiBase(base);
  } catch {
    /* mantém default */
  }

  observeReveals(document);

  // 1) Detecta a pasta de mods.
  try {
    const info = await detectModsDir();
    state.dir = info.path;
    setModsDir(info.path + (info.created ? ' (criada)' : ''));
  } catch (e) {
    setModsDir('ERRO: ' + e);
    toast('Não consegui detectar a pasta do Minecraft.', 'err');
    return;
  }

  await refreshStatus();
  await loadAndCompare();

  // Botões.
  const installBtn = document.getElementById('installBtn');
  if (installBtn) {
    installBtn.addEventListener('click', onInstall);
  }
  const openBtn = document.getElementById('openFolderBtn');
  if (openBtn) {
    openBtn.addEventListener('click', async () => {
      if (state.dir) {
        try {
          await openMinecraftFolder(state.dir);
        } catch {
          /* ignora */
        }
      }
    });
  }
  const refreshBtn = document.getElementById('refreshBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      await refreshStatus();
      await loadAndCompare();
      toast('Lista atualizada.', 'ok');
    });
  }

  // Polling leve de status.
  setInterval(refreshStatus, 8000);
}

async function onInstall() {
  const pending = pendingMods(state.comparison);
  if (!pending.length || !state.dir) return;

  const installBtn = document.getElementById('installBtn');
  if (installBtn) installBtn.disabled = true;
  showProgress(true, `Baixando 0/${pending.length}…`);
  setProgress(0, pending.length);

  try {
    const { downloaded, failed } = await downloadPending(
      state.dir,
      pending,
      (done, total) => setProgress(done, total)
    );
    showProgress(false);
    if (failed.length === 0) {
      toast(`✅ ${downloaded} mod(s) instalado(s)!`, 'ok');
    } else {
      toast(`⚠️ ${downloaded} OK, ${failed.length} falharam.`, 'err');
      console.error('Falhas:', failed);
    }
    // Re-compara para refletir o novo estado.
    await loadAndCompare();
  } catch (e) {
    showProgress(false);
    toast('Erro no download: ' + e.message, 'err');
  } finally {
    if (installBtn) installBtn.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', init);
