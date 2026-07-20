// wizard.js — wizard de primeira execução (5 passos, sem checagem de originalidade).
//
// Passos:
//   1) detect_launcher()  -> Minecraft instalado? qual launcher? (não bloqueia por original)
//   2) server_status()    -> versão do servidor vs 1.20.1 (alvo Forge 1.20.1-47.4.21)
//   3) mods faltando?     -> list_local_mods + server_mods + compareMods; baixa pendentes
//   4) ensure_forge()     -> idempotente; se Java ausente, oferece "Tentar de novo"
//   5) concluído          -> check animado + resumo + "Entrar" (grava flag, vai pra home)
//
// REGRA DO OWNER: não verificamos se é "original" e não bloqueamos nenhum launcher.

import { detectLauncher, serverStatus, ensureForge, detectModsDir, listLocalMods } from './fs.js';
import { fetchServerMods } from './api.js';
import { compareMods, pendingMods, downloadPending } from './mods.js';
import { showProgress, setProgress, toast, showError, hideError } from './ui.js';

const TARGET_MC = '1.20.1';
const FORGE_TARGET = '1.20.1-47.4.21';

const ONBOARDED_KEY = 'nexus_onboarded';

export function isOnboarded() {
  try { return localStorage.getItem(ONBOARDED_KEY) === '1'; } catch { return false; }
}

export function markOnboarded() {
  try { localStorage.setItem(ONBOARDED_KEY, '1'); } catch { /* ignore */ }
}

/** Inicia o wizard. `ctx` = { dir, onFinish }. */
export async function startWizard(ctx) {
  const { onFinish } = ctx;

  const wizard = document.getElementById('wizard');
  const backBtn = document.getElementById('wizardBack');
  const nextBtn = document.getElementById('wizardNext');
  const progressBar = document.getElementById('wizardProgressBar');

  const state = {
    dir: ctx.dir || null,
    launcher: null,
    status: null,
    serverMods: [],
    pendingCount: 0,
    forgeStatus: null,
    step: 0,
  };
  const TOTAL = 5;

  function setProgressWidth(step) {
    progressBar.style.width = `${Math.round(((step + 1) / TOTAL) * 100)}%`;
  }

  function showStep(index, animate = true) {
    const steps = document.querySelectorAll('.wizard-step');
    steps.forEach((el) => {
      const s = Number(el.dataset.step) - 1;
      if (s === index) {
        el.hidden = false;
        if (animate) {
          el.classList.remove('out');
          // força reflow p/ reexecutar a animação de entrada
          void el.offsetWidth;
        }
      } else {
        el.hidden = true;
      }
    });
    state.step = index;
    setProgressWidth(index);
    backBtn.disabled = index === 0;
    if (index === TOTAL - 1) {
      nextBtn.textContent = 'Entrar';
    } else {
      nextBtn.textContent = 'Próximo';
    }
  }

  function setNextEnabled(enabled) {
    nextBtn.disabled = !enabled;
  }

  // ---- Passo 1: detect_launcher ----
  async function enterStep1() {
    const body = document.getElementById('wizardStep1Body');
    const note = document.getElementById('step1Note');
    const status = document.getElementById('detectStatus');
    setNextEnabled(false);
    note.textContent = '';
    status.textContent = 'Detectando launcher…';
    try {
      const info = await detectLauncher();
      state.launcher = info;
      const labels = {
        official: 'Minecraft Launcher oficial',
        tlauncher: 'TLauncher',
        other: 'Outro launcher',
        none: 'Nenhum launcher encontrado',
      };
      const label = labels[info.launcher] || info.launcher;
      body.innerHTML = `
        <div class="stat"><span class="muted">Launcher</span><strong>${label}</strong></div>
        <div class="stat"><span class="muted">Minecraft instalado</span><strong>${info.minecraft_installed ? 'Sim' : 'Não'}</strong></div>
        <div class="stat"><span class="muted">Java (p/ Forge)</span><strong>${info.java_present ? 'Sim' : 'Não'}</strong></div>
      `;
      if (info.minecraft_installed) {
        note.className = 'note';
        note.textContent = '';
        setNextEnabled(true);
      } else {
        // Trava o avanço até instalar (sem bloquear por originalidade).
        note.className = 'note';
        note.textContent = 'Instale o Minecraft (Launcher oficial ou TLauncher) e reinicie o Nexus Launcher para continuar.';
        setNextEnabled(false);
      }
    } catch (e) {
      status.textContent = 'Falha ao detectar o launcher.';
      note.className = 'note';
      note.textContent = 'Não consegui detectar o launcher. Você pode continuar mesmo assim.';
      setNextEnabled(true);
    }
  }

  // ---- Passo 2: versão do servidor ----
  async function enterStep2() {
    const body = document.getElementById('wizardStep2Body');
    const status = document.getElementById('versionStatus');
    setNextEnabled(false);
    status.textContent = 'Verificando versão do servidor…';
    try {
      const s = await serverStatus();
      state.status = s;
      const ok = (s.version || '').includes(TARGET_MC) || s.version === TARGET_MC;
      body.innerHTML = `
        <div class="stat"><span class="muted">Versão do servidor</span><strong>${s.version || '—'}</strong></div>
        <div class="stat"><span class="muted">Alvo</span><strong>${FORGE_TARGET}</strong></div>
        <div class="stat"><span class="muted">Status</span><strong>${s.running ? 'Online' : 'Offline'}</strong></div>
      `;
      status.textContent = ok
        ? `Servidor em ${s.version} — compatível com ${TARGET_MC}.`
        : `Servidor em ${s.version}. O Nexus vai garantir o Forge ${FORGE_TARGET}.`;
      setNextEnabled(true);
    } catch (e) {
      status.textContent = 'Não foi possível consultar o servidor (offline?).';
      body.innerHTML = `<p class="muted">Você pode continuar; o launcher tentará de novo na home.</p>`;
      setNextEnabled(true);
    }
  }

  // ---- Passo 3: mods ----
  async function enterStep3() {
    const body = document.getElementById('wizardStep3Body');
    const status = document.getElementById('modsStatus');
    setNextEnabled(false);

    if (!state.dir) {
      // Tenta detectar a pasta de mods agora.
      try {
        const info = await detectModsDir();
        state.dir = info.path;
      } catch {
        status.textContent = 'Não consegui localizar a pasta de mods.';
        body.innerHTML = `<p class="muted">Você pode baixar os mods depois na home.</p>`;
        setNextEnabled(true);
        return;
      }
    }

    status.textContent = 'Comparando mods locais x servidor…';
    let comparison = [];
    let pending = [];
    try {
      const serverMods = await fetchServerMods();
      const localMods = await listLocalMods(state.dir);
      state.serverMods = serverMods;
      comparison = compareMods(serverMods, localMods);
      pending = pendingMods(comparison);
    } catch (e) {
      status.textContent = 'Falha ao comparar mods (servidor offline?).';
      body.innerHTML = `<p class="muted">Você pode atualizar os mods depois na home.</p>`;
      setNextEnabled(true);
      return;
    }

    state.pendingCount = pending.length;
    if (!pending.length) {
      status.textContent = 'Todos os mods estão em dia. 🎉';
      body.innerHTML = `<p class="muted">Nenhum mod pendente (${comparison.length} mods do servidor).</p>`;
      setNextEnabled(true);
      return;
    }

    status.textContent = `Faltam ${pending.length} mod(s). Baixando…`;
    body.innerHTML = `<p class="muted">Baixando ${pending.length} mod(s) pendente(s)…</p>`;
    showProgress(true, `Baixando 0/${pending.length}`);
    setProgress(0, pending.length);
    try {
      const { downloaded, failed } = await downloadPending(state.dir, pending, (done, total) => setProgress(done, total));
      showProgress(false);
      status.textContent = `${downloaded} mod(s) baixado(s)${failed.length ? `, ${failed.length} falharam` : ''}.`;
      body.innerHTML = `<p class="muted">${downloaded} atualizado(s). ${failed.length ? `${failed.length} falha(m) — tente de novo na home.` : 'Tudo certo!'}</p>`;
    } catch (e) {
      showProgress(false);
      status.textContent = 'Falha ao baixar mods.';
      body.innerHTML = `<p class="muted">Erro: ${String(e.message || e)}. Você pode tentar de novo na home.</p>`;
    }
    setNextEnabled(true);
  }

  // ---- Passo 4: ensure_forge ----
  async function runForge() {
    const body = document.getElementById('wizardStep4Body');
    const status = document.getElementById('forgeStatus');
    setNextEnabled(false);
    status.textContent = 'Garantindo Forge 1.20.1…';
    try {
      const f = await ensureForge(TARGET_MC);
      state.forgeStatus = f;
      if (!f.java_present) {
        status.textContent = 'Java não encontrado.';
        body.innerHTML = `
          <p class="muted">O Forge 1.20.1 precisa do Java 21+. Instale o Java 21+ (Adoptium/Temurin) e clique em “Tentar de novo”.</p>
          <button id="forgeRetry" class="btn primary">Tentar de novo</button>`;
        document.getElementById('forgeRetry')?.addEventListener('click', runForge);
        setNextEnabled(false);
        return;
      }
      status.textContent = f.installed ? `Forge pronto (${f.profile}).` : (f.message || 'Forge preparado.');
      body.innerHTML = `<p class="muted">${f.message || 'Perfil Forge configurado.'}</p>`;
      setNextEnabled(true);
    } catch (e) {
      status.textContent = 'Falha ao preparar o Forge.';
      body.innerHTML = `
        <p class="muted">Erro: ${String(e.message || e)}</p>
        <button id="forgeRetry" class="btn primary">Tentar de novo</button>`;
      document.getElementById('forgeRetry')?.addEventListener('click', runForge);
      setNextEnabled(false);
    }
  }
  async function enterStep4() { await runForge(); }

  // ---- Passo 5: concluído ----
  async function enterStep5() {
    const summary = document.getElementById('wizardSummary');
    const li = [];
    if (state.launcher) {
      const labels = { official: 'Minecraft Launcher oficial', tlauncher: 'TLauncher', other: 'Outro launcher', none: 'Nenhum launcher' };
      li.push(`<li>Launcher: ${labels[state.launcher.launcher] || state.launcher.launcher} (Minecraft ${state.launcher.minecraft_installed ? 'instalado' : 'ausente'})</li>`);
    }
    if (state.status) {
      li.push(`<li>Servidor: ${state.status.version || '—'} (${state.status.running ? 'online' : 'offline'})</li>`);
    }
    li.push(`<li>Mods baixados: ${state.pendingCount === 0 ? 'todos em dia' : `${state.pendingCount} pendente(s) resolvido(s)`}</li>`);
    if (state.forgeStatus) {
      li.push(`<li>Forge: ${state.forgeStatus.installed ? state.forgeStatus.profile : 'não instalado'}${state.forgeStatus.java_present ? '' : ' (sem Java)'}</li>`);
    }
    summary.innerHTML = li.join('');
    setNextEnabled(true);
  }

  const ENTER = [enterStep1, enterStep2, enterStep3, enterStep4, enterStep5];

  // Navegação
  nextBtn.addEventListener('click', async () => {
    if (nextBtn.disabled) return;
    if (state.step === TOTAL - 1) {
      // Conclui o wizard.
      markOnboarded();
      hideError();
      onFinish();
      return;
    }
    const next = state.step + 1;
    showStep(next);
    await ENTER[next]();
  });

  backBtn.addEventListener('click', async () => {
    if (backBtn.disabled) return;
    const prev = state.step - 1;
    showStep(prev);
    await ENTER[prev]();
  });

  // Inicia
  wizard.hidden = false;
  showStep(0);
  await ENTER[0]();
}
