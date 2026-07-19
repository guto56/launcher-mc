// =============================================================================
// ui.js — Renderização da lista de mods, status, barra de progresso e toast.
// =============================================================================

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtSize(bytes) {
  if (!bytes) return '0 KB';
  const mb = bytes / (1024 * 1024);
  if (mb >= 0.1) return mb.toFixed(1) + ' MB';
  return (bytes / 1024).toFixed(0) + ' KB';
}

const STATE_LABEL = {
  ok: '✓ instalado',
  missing: '＋ faltando',
  outdated: '↑ desatualizado',
};

export function setStatus(running, players) {
  const badge = document.getElementById('statusBadge');
  const text = document.getElementById('statusText');
  const playersText = document.getElementById('playersText');
  if (badge) badge.classList.toggle('online', !!running);
  if (text) text.textContent = running ? 'ONLINE' : 'OFFLINE';
  if (playersText) playersText.textContent = players != null ? `👥 ${players}` : '';
}

export function setModsDir(path) {
  const el = document.getElementById('modsDirPath');
  if (el) el.textContent = path || 'não detectada';
}

function modCard(m, i) {
  const stateClass = m.state || 'ok';
  const local = m.localVersion ? ` (local v${escapeHtml(m.localVersion)})` : '';
  const desc = m.description
    ? `<div class="mod-meta" style="color:var(--muted)">${escapeHtml(m.description)}</div>`
    : '';
  return `<div class="mod-card glass reveal" style="--i:${i}">
    <div class="mod-icon">⚙️</div>
    <div class="mod-info">
      <div class="mod-name">${escapeHtml(m.name)}</div>
      <div class="mod-meta">servidor v${escapeHtml(m.version || '?')} · ${fmtSize(m.size)}${local}</div>
      ${desc}
      <span class="mod-state ${stateClass}">${STATE_LABEL[stateClass] || stateClass}</span>
    </div>
  </div>`;
}

export function renderMods(comparison) {
  const grid = document.getElementById('modGrid');
  const count = document.getElementById('modCount');
  if (!grid) return;
  if (!comparison.length) {
    grid.innerHTML = '<div class="empty-state">Nenhum mod exigido pelo servidor no momento.</div>';
  } else {
    grid.innerHTML = comparison.map(modCard).join('');
  }
  if (count) count.textContent = `(${comparison.length})`;
  observeReveals(grid);
}

export function setDiffSummary(pending, total) {
  const el = document.getElementById('diffSummary');
  if (!el) return;
  if (pending === 0) {
    el.textContent = total ? 'Tudo em dia! ✓' : '';
    el.style.color = 'var(--online)';
  } else {
    el.textContent = `${pending} de ${total} precisam de download`;
    el.style.color = 'var(--warn)';
  }
}

export function setInstallEnabled(enabled, label) {
  const btn = document.getElementById('installBtn');
  if (!btn) return;
  btn.disabled = !enabled;
  if (label) btn.textContent = label;
}

export function showProgress(show, label) {
  const wrap = document.getElementById('progressWrap');
  if (!wrap) return;
  wrap.style.display = show ? 'block' : 'none';
  if (label) {
    const l = document.getElementById('progressLabel');
    if (l) l.textContent = label;
  }
  if (!show) setProgress(0);
}

export function setProgress(done, total) {
  const bar = document.getElementById('progressBar');
  const pct = document.getElementById('progressPct');
  const label = document.getElementById('progressLabel');
  const ratio = total ? Math.round((done / total) * 100) : 0;
  if (bar) bar.style.width = ratio + '%';
  if (pct) pct.textContent = ratio + '%';
  if (label && total) label.textContent = `Baixando ${done}/${total}…`;
}

let toastTimer = null;
export function toast(msg, kind = 'ok') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.className = 'toast ' + kind;
  }, 3200);
}

// Intersection Observer (reveal) — igual ao site.
const io = new IntersectionObserver(
  (entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) {
        e.target.classList.add('in');
        io.unobserve(e.target);
      }
    });
  },
  { threshold: 0.12 }
);

export function observeReveals(root) {
  (root || document).querySelectorAll('.reveal:not(.in)').forEach((el) => io.observe(el));
}
