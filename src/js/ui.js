function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtSize(bytes) {
  if (!bytes) return '0 KB';
  const mb = bytes / (1024 * 1024);
  return mb >= 0.1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

export function setStatus(running, players) {
  const el = document.getElementById('statusText');
  const badge = document.getElementById('statusBadge');
  const p = document.getElementById('playersText');
  if (el) el.textContent = running ? 'ONLINE' : 'OFFLINE';
  if (badge) badge.classList.toggle('online', !!running);
  if (p) p.textContent = players != null ? `${players} jogadores` : '';
}

export function setModsDir(path) {
  const el = document.getElementById('modsDirPath');
  if (el) el.textContent = path || 'não detectada';
}

export function setDiffSummary(pending, total) {
  const el = document.getElementById('diffSummary');
  if (!el) return;
  el.textContent = total ? `${pending}/${total} precisam de ação` : '';
}

export function setPlayStatus(msg) {
  const el = document.getElementById('playStatus');
  if (el) el.textContent = msg || '';
}

export function setInstallEnabled(enabled, label) {
  const btn = document.getElementById('installBtn');
  if (!btn) return;
  btn.disabled = !enabled;
  if (label) btn.textContent = label;
}

export function showProgress(show, label) {
  const wrap = document.getElementById('progressWrap');
  const l = document.getElementById('progressLabel');
  if (wrap) wrap.style.display = show ? 'block' : 'none';
  if (l && label) l.textContent = label;
  if (!show) setProgress(0, 0);
}

export function setProgress(done, total) {
  const bar = document.getElementById('progressBar');
  const pct = document.getElementById('progressPct');
  const ratio = total ? Math.round((done / total) * 100) : 0;
  if (bar) bar.style.width = `${ratio}%`;
  if (pct) pct.textContent = `${ratio}%`;
}

export function showError(msg) {
  const box = document.getElementById('errorBox');
  if (box) {
    box.textContent = msg;
    box.style.display = 'block';
  }
}

export function hideError() {
  const box = document.getElementById('errorBox');
  if (box) box.style.display = 'none';
}

let timer = null;
export function toast(msg, kind = 'ok') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  clearTimeout(timer);
  timer = setTimeout(() => {
    el.className = `toast ${kind}`;
  }, 2800);
}

export function renderMods(comparison, error) {
  const grid = document.getElementById('modGrid');
  const count = document.getElementById('modCount');
  if (!grid) return;

  if (error) {
    grid.innerHTML = `<div class="card error">${escapeHtml(error.message || error)}</div>`;
    if (count) count.textContent = '';
    return;
  }

  if (!comparison.length) {
    grid.innerHTML = '<div class="empty">Nenhum mod exigido pelo servidor.</div>';
  } else {
    grid.innerHTML = comparison.map((mod) => {
      const state = mod.state;
      return `<article class="card mod ${state}">
        <div class="mod-head">
          <strong>${escapeHtml(mod.name)}</strong>
          <span>${state}</span>
        </div>
        <div class="muted">Servidor: ${escapeHtml(mod.version || '-')} · Local: ${escapeHtml(mod.localVersion || '-')} · ${fmtSize(mod.size)}</div>
        <div class="muted">${escapeHtml(mod.description || '')}</div>
      </article>`;
    }).join('');
  }
  if (count) count.textContent = `(${comparison.length})`;
}
