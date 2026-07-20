import { detectModsDir, listLocalMods, openMinecraftFolder, getBaseUrl, ensureFabric, launchMinecraft } from './fs.js';
import { fetchServerMods, fetchStatus } from './api.js';
import { compareMods, pendingMods, downloadPending } from './mods.js';
import { setStatus, setModsDir, renderMods, setDiffSummary, setInstallEnabled, showProgress, setProgress, toast, showError, hideError, setPlayStatus } from './ui.js';

const state = {
  dir: null,
  comparison: [],
  version: '1.20.1',
};

async function refreshStatus() {
  try {
    const status = await fetchStatus();
    setStatus(status.running, status.playersOnline);
    if (status.version) state.version = status.version;
  } catch {
    setStatus(false, null);
  }
}

async function loadAndCompare() {
  try {
    const serverMods = await fetchServerMods();
    const localMods = state.dir ? await listLocalMods(state.dir) : [];
    state.comparison = compareMods(serverMods, localMods);
    renderMods(state.comparison);
    const pending = pendingMods(state.comparison);
    setDiffSummary(pending.length, state.comparison.length);

    if (!state.dir) {
      setInstallEnabled(false, 'Pasta não detectada');
    } else if (!pending.length) {
      setInstallEnabled(true, 'Tudo em dia');
    } else {
      setInstallEnabled(true, 'Atualizar mods');
    }
  } catch (e) {
    renderMods([], e);
    toast('Falha ao carregar mods.', 'err');
  }
}

async function onInstall() {
  const pending = pendingMods(state.comparison);
  if (!state.dir || !pending.length) return;

  const btn = document.getElementById('installBtn');
  if (btn) btn.disabled = true;

  showProgress(true, `Baixando 0/${pending.length}`);
  setProgress(0, pending.length);

  try {
    const { downloaded, failed } = await downloadPending(state.dir, pending, (done, total) => setProgress(done, total));
    showProgress(false);
    toast(failed.length ? `${downloaded} ok, ${failed.length} falharam` : `${downloaded} mod(s) atualizados`, failed.length ? 'err' : 'ok');
    await loadAndCompare();
  } catch (e) {
    showProgress(false);
    showError(String(e.message || e));
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function onPlay() {
  const btn = document.getElementById('playBtn');
  if (btn) btn.disabled = true;
  hideError();
  try {
    setPlayStatus('Verificando/instalando Fabric…');
    const status = await ensureFabric(state.version);
    if (!status.java_present) {
      setPlayStatus('Java não encontrado. Instale o Java 17+ (Adoptium/Temurin) e tente de novo.');
      showError('Java não encontrado. Instale o Java 17+ (Adoptium/Temurin) e tente de novo.');
      return;
    }
    if (!status.installed) {
      setPlayStatus(status.message || 'Não foi possível preparar o Fabric.');
      showError('Erro ao preparar o Fabric: ' + (status.message || 'desconhecido'));
      return;
    }
    setPlayStatus(`Fabric pronto (${status.profile}). Abrindo Minecraft…`);
    await launchMinecraft(status.profile);
    setPlayStatus('Minecraft aberto no perfil Fabric. Clique em Play no launcher.');
    toast('Minecraft aberto no perfil Fabric', 'ok');
  } catch (e) {
    setPlayStatus('');
    showError('Erro ao jogar: ' + (e && e.message ? e.message : String(e)));
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function init() {
  try {
    const base = await getBaseUrl();
    window.__LAUNCHER_API_BASE__ = base;
  } catch {
    /* noop */
  }

  try {
    const info = await detectModsDir();
    state.dir = info.path;
    setModsDir(info.path);
    hideError();
  } catch (e) {
    state.dir = null;
    setModsDir('não detectada');
    showError(`Não consegui detectar a pasta de mods: ${e.message || e}`);
  }

  await refreshStatus();
  await loadAndCompare();

  document.getElementById('installBtn')?.addEventListener('click', onInstall);
  document.getElementById('playBtn')?.addEventListener('click', onPlay);
  document.getElementById('refreshBtn')?.addEventListener('click', async () => {
    await refreshStatus();
    await loadAndCompare();
    toast('Atualizado', 'ok');
  });
  document.getElementById('openFolderBtn')?.addEventListener('click', async () => {
    if (state.dir) await openMinecraftFolder(state.dir);
  });

  setInterval(refreshStatus, 10000);
}

document.addEventListener('DOMContentLoaded', init);
