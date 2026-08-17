/* ============ DJBoard display mode (read-only) ============ */

let notes = [];
let tags = [];
let groups = [];
let settings = {};
// not saved across reloads on purpose — a kiosk device should always come
// up showing everything, regardless of what was last clicked on it
let period = 'all';

const $ = (id) => document.getElementById(id);
const tagById = (id) => tags.find((t) => t.id === id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' · ' +
    d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// apply saved theme/font — a ?theme=light|dark URL param (e.g. from a kiosk
// launcher) overrides whatever's saved, so a stale localStorage value on a
// device you don't interact with can't get stuck
const themeParam = new URLSearchParams(location.search).get('theme');
const theme = (themeParam === 'light' || themeParam === 'dark') ? themeParam : (localStorage.getItem('mb-theme') || 'light');
document.documentElement.dataset.theme = theme;
document.documentElement.dataset.font = localStorage.getItem('mb-font') || 'roboto';

// autoscale for TVs: below this width the board renders exactly as it
// always has (this is the old .container content width, 1400px minus its
// side padding). Past it — a TV, not a browser window — fix the stage back
// to that design width and scale the whole thing up with a transform so
// cards, text and widgets all grow together to fill the screen, instead of
// the masonry layout just adding more same-sized columns.
const STAGE_DESIGN_WIDTH = 1344;
let stageScale = 1;

function syncStageHeight() {
  const wrap = $('displayStageWrap');
  const stage = $('displayStage');
  if (!wrap || !stage) return;
  wrap.style.height = stage.style.transform ? (stage.scrollHeight * stageScale) + 'px' : '';
}

function applyStageScale() {
  const wrap = $('displayStageWrap');
  const stage = $('displayStage');
  if (!wrap || !stage) return;
  const mobile = document.documentElement.dataset.ui === 'mobile';
  const available = wrap.clientWidth;
  if (mobile || available <= STAGE_DESIGN_WIDTH) {
    stageScale = 1;
    stage.style.width = '';
    stage.style.transform = '';
    wrap.style.height = '';
    return;
  }
  stageScale = available / STAGE_DESIGN_WIDTH;
  stage.style.width = STAGE_DESIGN_WIDTH + 'px';
  stage.style.transform = `scale(${stageScale})`;
  syncStageHeight();
}
window.addEventListener('resize', applyStageScale);
document.addEventListener('DOMContentLoaded', () => {
  applyStageScale();
  const stage = $('displayStage');
  if (stage && window.ResizeObserver) new ResizeObserver(syncStageHeight).observe(stage);
});

// mobile / desktop layout mode (auto-detect + manual override)
const mobileQuery = matchMedia('(max-width: 820px)');
function detectMobile() {
  return mobileQuery.matches;
}
mobileQuery.addEventListener('change', () => applyUiMode());
function applyUiMode() {
  const pref = localStorage.getItem('mb-ui') || 'auto';
  const mode = pref === 'auto' ? (detectMobile() ? 'mobile' : 'desktop') : pref;
  document.documentElement.dataset.ui = mode;
  const btn = $('uiModeToggle');
  if (btn) {
    btn.textContent = mode === 'mobile' ? '🖥' : '📱';
    btn.title = (mode === 'mobile' ? 'Switch to desktop layout' : 'Switch to mobile layout') +
      (pref === 'auto' ? ' (currently auto-detected)' : '');
  }
  applyStageScale();
}
document.addEventListener('DOMContentLoaded', () => {
  $('uiModeToggle').onclick = () => {
    const next = document.documentElement.dataset.ui === 'mobile' ? 'desktop' : 'mobile';
    const auto = detectMobile() ? 'mobile' : 'desktop';
    localStorage.setItem('mb-ui', next === auto ? 'auto' : next);
    applyUiMode();
  };
  applyUiMode();
});
window.addEventListener('resize', applyUiMode);
applyUiMode();

function periodStart(p) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (p === 'today') return start;
  if (p === 'week') {
    const dow = (start.getDay() + 6) % 7; // Monday start
    start.setDate(start.getDate() - dow);
    return start;
  }
  if (p === 'month') return new Date(now.getFullYear(), now.getMonth(), 1);
  return null; // all
}

function inPeriod(n) {
  const start = periodStart(period);
  if (!start) return true;
  return new Date(n.updatedAt) >= start || new Date(n.createdAt) >= start;
}

/* ============ freeform board layout (read-only mirror of app.js) ============
   Same saved x/y positions as the editable board — this page never writes
   them back, it just lays cards out where the board already put them. Notes
   that have never been positioned (no saved x/y) fall back to a packed
   column placement, computed locally each render rather than persisted. */
const BOARD_COL_W = 270;
const BOARD_GAP = 16;

function layoutBoardHeight() {
  const board = $('board');
  let maxBottom = 0;
  for (const el of board.children) {
    if (el.classList.contains('note-card') || el.classList.contains('note-stack')) {
      maxBottom = Math.max(maxBottom, el.offsetTop + el.offsetHeight);
    }
  }
  board.style.height = Math.max(maxBottom + 24, 0) + 'px';
}

function placeUnpositioned(board, entries) {
  const width = board.clientWidth || 900;
  const cols = Math.max(1, Math.floor((width + BOARD_GAP) / (BOARD_COL_W + BOARD_GAP)));
  const colHeights = new Array(cols).fill(0);

  const positioned = entries.filter((e) => e.n.x != null && e.n.y != null);
  const unpositioned = entries.filter((e) => e.n.x == null || e.n.y == null);

  positioned.forEach(({ n, card }) => {
    const col = Math.min(cols - 1, Math.max(0, Math.round(n.x / (BOARD_COL_W + BOARD_GAP))));
    colHeights[col] = Math.max(colHeights[col], n.y + card.offsetHeight + BOARD_GAP);
  });

  unpositioned.sort((a, b) => (b.n.pinned - a.n.pinned));
  unpositioned.forEach(({ n, card }) => {
    let col = 0;
    for (let i = 1; i < cols; i++) if (colHeights[i] < colHeights[col]) col = i;
    const x = col * (BOARD_COL_W + BOARD_GAP);
    const y = colHeights[col];
    card.style.left = x + 'px';
    card.style.top = y + 'px';
    colHeights[col] = y + card.offsetHeight + BOARD_GAP;
  });
}

function noteCard(n) {
  const card = document.createElement('div');
  card.className = 'note-card' + (n.pinned ? ' pinned-card' : '') + (n.done ? ' done-card' : '');
  if (n.color) card.style.borderColor = n.color;
  if (n.textColor) card.style.color = n.textColor;
  const done = n.checklist.filter((c) => c.done).length;
  card.innerHTML = `
    <div class="dates">
      <span>${n.pinned ? '<span class="pin-flag">📌 PINNED · </span>' : ''}${fmtDate(n.createdAt)}</span>
      ${n.updatedAt !== n.createdAt ? `<span title="Last edited">✎ ${fmtDate(n.updatedAt)}</span>` : ''}
    </div>
    ${n.tags.length ? `<div class="card-tags">${n.tags.map((id) => {
      const t = tagById(id);
      return t ? `<span class="card-tag" style="background:${t.color}">#${esc(t.name)}</span>` : '';
    }).join('')}</div>` : ''}
    ${n.title ? `<h3>${esc(n.title)}</h3>` : ''}
    ${n.text ? `<div class="body-text">${esc(n.text)}</div>` : ''}
    ${n.checklist.length ? `<div class="card-checklist">${n.checklist.map((item) =>
      `<div class="check-item ${item.done ? 'done' : ''}"><input type="checkbox" disabled ${item.done ? 'checked' : ''}/><span>${esc(item.text)}</span></div>`
    ).join('')}</div><div class="check-progress">${done}/${n.checklist.length} done</div>` : ''}
    ${n.images.length ? `<div class="card-images">${n.images.map((u) => `<img src="${u}" loading="lazy"/>`).join('')}</div>` : ''}
  `;

  if (n.done) {
    card.insertAdjacentHTML('beforeend', `
      <svg class="done-mark" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <path d="M 6,93 C 24,79 39,63 51,51 C 63,39 78,23 94,7" />
        <path d="M 7,92 C 23,80 38,61 50,52 C 65,37 79,21 93,8" />
      </svg>
    `);
  }

  return card;
}

// read-only mirror of app.js's stackCard — no name input, no drag, no way to
// pull a note back out, just the same face a grouped deck shows on the board
function stackCard(g, members) {
  const wrap = document.createElement('div');
  wrap.className = 'note-stack';

  const header = document.createElement('div');
  header.className = 'stack-header';
  const icon = document.createElement('span');
  icon.className = 'stack-title-icon';
  icon.textContent = '🗂';
  const name = document.createElement('span');
  name.className = 'stack-name-input';
  name.textContent = g.name || 'Untitled group';
  const badge = document.createElement('span');
  badge.className = 'stack-badge';
  badge.textContent = members.length;
  header.append(icon, name, badge);
  wrap.appendChild(header);

  const list = document.createElement('div');
  list.className = 'card-checklist group-checklist';
  members
    .slice()
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .forEach((n) => {
      const row = document.createElement('div');
      row.className = 'check-item' + (n.done ? ' done' : '');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = n.done;
      cb.disabled = true;
      const span = document.createElement('span');
      span.textContent = n.title || n.text || 'Untitled note';
      row.append(cb, span);
      list.appendChild(row);
    });
  wrap.appendChild(list);
  return wrap;
}

function renderDoneColumn(doneNotes) {
  const list = $('doneColumnList');
  list.innerHTML = '';
  doneNotes
    .slice()
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .forEach((n) => list.appendChild(noteCard(n)));
}

function render() {
  document.querySelectorAll('.period-btn').forEach((b) =>
    b.classList.toggle('active', b.dataset.period === period));
  const board = $('board');
  board.innerHTML = '';
  board.style.height = '';

  const visible = notes.filter(inPeriod);
  const visibleIds = new Set(visible.map((n) => n.id));
  const ungrouped = visible.filter((n) => !n.groupId);
  const openNotes = ungrouped.filter((n) => !n.done);
  const doneNotes = ungrouped.filter((n) => n.done);
  // same rule app.js uses for tag/search filtering — a group counts as visible
  // (and shows in full) as soon as any one of its members is in the period
  const visibleGroups = groups
    .map((g) => ({ g, members: notes.filter((n) => n.groupId === g.id) }))
    .filter(({ members }) => members.length >= 2 && members.some((n) => visibleIds.has(n.id)));

  renderDoneColumn(doneNotes);

  const entries = openNotes.map((n) => {
    const card = noteCard(n);
    const hasPos = n.x != null && n.y != null;
    card.style.left = (hasPos ? n.x : 0) + 'px';
    card.style.top = (hasPos ? n.y : 0) + 'px';
    if (!hasPos) card.style.visibility = 'hidden'; // only unplaced cards need the measure-then-place pass
    board.appendChild(card);
    return { n, card, hasPos };
  });

  visibleGroups.forEach(({ g, members }) => {
    const el = stackCard(g, members);
    el.style.left = (g.x ?? 20) + 'px';
    el.style.top = (g.y ?? 20) + 'px';
    board.appendChild(el);
  });

  if (entries.some((e) => !e.hasPos)) {
    requestAnimationFrame(() => {
      placeUnpositioned(board, entries);
      entries.forEach((e) => { e.card.style.visibility = ''; });
      layoutBoardHeight();
      applyStageScale();
    });
  } else {
    layoutBoardHeight();
  }

  $('displayEmpty').hidden = visible.length > 0;
  $('displayMeta').textContent =
    `${visible.length} note${visible.length === 1 ? '' : 's'} · updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · refreshes every 5 min`;
}

document.querySelectorAll('.period-btn').forEach((b) => {
  b.onclick = () => {
    period = b.dataset.period;
    render();
  };
});

// mirrors index.html's done-column position (set there by dragging its
// header) so the read-only kiosk view matches — this page never drags it itself
function applyDoneColumnPos() {
  const pos = settings.doneColumn;
  if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') return;
  const el = $('doneColumn');
  el.style.right = 'auto';
  el.style.left = pos.x + 'px';
  el.style.top = pos.y + 'px';
}

async function load() {
  [notes, tags, groups, settings] = await Promise.all([
    (await fetch('/api/notes')).json(),
    (await fetch('/api/tags')).json(),
    (await fetch('/api/groups')).json(),
    (await fetch('/api/settings')).json(),
  ]);
  render();
  applyDoneColumnPos();
  applyStageScale();
}

load();

// live refresh: re-fetch/re-render the instant the server saves a change,
// instead of waiting on the fallback timer below
new EventSource('/api/events').addEventListener('refresh', () => load());

// full reload every 5 minutes as a fallback (e.g. picks up new display.js
// after a deploy, and recovers if the connection above ever gets stuck)
setTimeout(() => location.reload(), 5 * 60 * 1000);
