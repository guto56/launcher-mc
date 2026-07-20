import { detectModsDir, listLocalMods, openMinecraftFolder, getBaseUrl, ensureForge, launchMinecraft, detectLauncher } from './fs.js';
import { fetchServerMods, fetchStatus } from './api.js';
import { compareMods, pendingMods, downloadPending } from './mods.js';
import { setStatus, setHomeStats, setModsDir, renderMods, setDiffSummary, setInstallEnabled, showProgress, setProgress, toast, showError, hideError, setPlayStatus, showHome } from './ui.js';
import { hideSplash } from './splash.js';
import { isOnboarded, startWizard } from './wizard.js';

const state = {
  dir: null,
  comparison: [],
  version: '1.20.1',
  onboarded: false,
};

async function refreshStatus() {
  try {
    const status = await fetchStatus();
    setStatus(status.running, status.playersOnline);
    setHomeStats(status);
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
    setPlayStatus('Verificando/instalando Forge…');
    const status = await ensureForge(state.version);
    if (!status.java_present) {
      setPlayStatus('Java não encontrado. Instale o Java 21+ (Adoptium/Temurin) e tente de novo.');
      showError('Java não encontrado. Instale o Java 21+ (Adoptium/Temurin) e tente de novo.');
      return;
    }
    if (!status.installed) {
      setPlayStatus(status.message || 'Não foi possível preparar o Forge.');
      showError('Erro ao preparar o Forge: ' + (status.message || 'desconhecido'));
      return;
    }
    setPlayStatus(`Forge pronto (${status.profile}). Abrindo Minecraft…`);
    await launchMinecraft(status.profile);
    setPlayStatus('Minecraft aberto no perfil Forge. Clique em Play no launcher.');
    toast('Minecraft aberto no perfil Forge', 'ok');
  } catch (e) {
    setPlayStatus('');
    showError('Erro ao jogar: ' + (e && e.message ? e.message : String(e)));
  } finally {
    if (btn) btn.disabled = false;
  }
}

function wireHomeButtons() {
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
}

async function init() {
  wireHomeButtons();

  try {
    const base = await getBaseUrl();
    window.__LAUNCHER_API_BASE__ = base;
  } catch { /* noop */ }

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

  // Define o fluxo: wizard (1ª vez) ou home direto.
  state.onboarded = isOnboarded();

  if (!state.onboarded) {
    await startWizard({
      dir: state.dir,
      onFinish: async () => {
        showHome();
        finishBoot();
      },
    });
    // Esconde o splash assim que o wizard está montado.
    hideSplash();
  } else {
    showHome();
    finishBoot();
    hideSplash();
  }
}

async function finishBoot() {
  await refreshStatus();
  await loadAndCompare();
  setInterval(refreshStatus, 10000);
}

document.addEventListener('DOMContentLoaded', init);
