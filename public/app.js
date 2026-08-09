/* ============ DJBoard frontend ============ */

const OUTLINE_COLORS = ['#4ade80', '#60a5fa', '#f87171', '#fbbf24', '#c084fc', '#f472b6', '#34d399', '#fb923c', '#22d3ee', '#a3e635', '#94a3b8', '#e879f9'];
const TEXT_COLORS = ['#4ade80', '#60a5fa', '#f87171', '#fbbf24', '#c084fc', '#f472b6', '#34d399', '#fb923c', '#22d3ee', '#a3e635'];
const TAG_COLORS = ['#4ade80', '#60a5fa', '#f87171', '#fbbf24', '#c084fc', '#f472b6', '#34d399', '#fb923c', '#22d3ee', '#a3e635', '#94a3b8', '#e879f9'];

let notes = [];
let tags = [];
let groups = [];
let activeTagIds = new Set();
let searchQuery = '';
let selectedNoteIds = new Set();
let cardById = new Map();
let kbdFocus = null; // { id, type: 'note' | 'stack' } — vim-style hjkl board cursor

// editing state
let editingNote = null; // working copy
let editingIsNew = false;
let editingMode = 'note'; // 'note' | 'list'
let newTagColor = TAG_COLORS[0];

const $ = (id) => document.getElementById(id);

/* ============ api ============ */
const api = {
  async get(url) { return (await fetch(url)).json(); },
  async send(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Request failed');
    return res.json();
  },
};

/* ============ helpers ============ */
function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' · ' +
    d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
function tagById(id) { return tags.find((t) => t.id === id); }
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ============ destructive-action confirmation ============ */
function confirmDeleteEnabled() {
  return localStorage.getItem('mb-confirm-delete') !== '0';
}
// drop-in replacement for confirm() on delete/remove/clear actions — if the
// user has turned confirmations off, the action proceeds immediately
function confirmDestructive(message) {
  return !confirmDeleteEnabled() || confirm(message);
}

/* ============ theme & font ============ */
function applyPrefs() {
  const theme = localStorage.getItem('mb-theme') || 'dark';
  const font = localStorage.getItem('mb-font') || 'roboto';
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.font = font;
  $('fontSelect').value = font;
}
$('themeToggle').onclick = () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  localStorage.setItem('mb-theme', next);
  document.documentElement.dataset.theme = next;
};
$('fontSelect').onchange = (e) => {
  localStorage.setItem('mb-font', e.target.value);
  document.documentElement.dataset.font = e.target.value;
};

/* ============ auth ============ */
fetch('/api/session').then((r) => r.json()).then(({ authRequired }) => {
  if (authRequired) $('logoutBtn').hidden = false;
}).catch(() => {});
$('logoutBtn').onclick = async () => {
  await fetch('/api/logout', { method: 'POST' });
  location.href = '/login.html';
};

/* ============ mobile / desktop layout mode ============ */
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
}
$('uiModeToggle').onclick = () => {
  const next = document.documentElement.dataset.ui === 'mobile' ? 'desktop' : 'mobile';
  const auto = detectMobile() ? 'mobile' : 'desktop';
  localStorage.setItem('mb-ui', next === auto ? 'auto' : next);
  applyUiMode();
};
window.addEventListener('resize', applyUiMode);
applyUiMode();

/* ============ tag row ============ */
function renderTagRow() {
  const row = $('tagRow');
  row.querySelectorAll('.tag-bubble').forEach((el) => el.remove());
  const sorted = [...tags].sort((a, b) => (b.pinned - a.pinned) || a.name.localeCompare(b.name));
  for (const t of sorted) {
    const btn = document.createElement('button');
    btn.className = 'tag-chip tag-bubble' + (activeTagIds.has(t.id) ? ' active' : '');
    btn.innerHTML = `<span class="dot" style="background:${t.color}"></span>#${esc(t.name)}${t.pinned ? ' <span class="pin-mark">📌</span>' : ''}`;
    btn.onclick = () => {
      activeTagIds.has(t.id) ? activeTagIds.delete(t.id) : activeTagIds.add(t.id);
      renderTagRow();
      renderBoard();
    };
    row.appendChild(btn);
  }
}

/* ============ board ============ */
function noteMatches(n) {
  if (activeTagIds.size && ![...activeTagIds].every((id) => n.tags.includes(id))) return false;
  if (!searchQuery) return true;
  const q = searchQuery.toLowerCase();
  const tagNames = n.tags.map((id) => tagById(id)?.name.toLowerCase() || '');
  return (
    n.title.toLowerCase().includes(q) ||
    n.text.toLowerCase().includes(q) ||
    n.checklist.some((c) => c.text.toLowerCase().includes(q)) ||
    tagNames.some((name) => name.includes(q) || ('#' + name).includes(q))
  );
}

function noteCard(n) {
  const card = document.createElement('div');
  card.className = 'note-card' + (n.pinned ? ' pinned-card' : '') + (n.done ? ' done-card' : '') + (selectedNoteIds.has(n.id) ? ' selected' : '');
  if (n.color) card.style.borderColor = n.color;
  if (n.textColor) card.style.color = n.textColor;

  const done = n.checklist.filter((c) => c.done).length;
  card.dataset.id = n.id;
  card.innerHTML = `
    <div class="dates">
      <span>${n.pinned ? '<span class="pin-flag">📌 PINNED · </span>' : ''}${fmtDate(n.createdAt)}</span>
      ${n.updatedAt !== n.createdAt ? `<span title="Last edited">✎ ${fmtDate(n.updatedAt)}</span>` : ''}
    </div>
    ${n.reminder?.enabled ? `<div class="card-reminder">⏰ ${fmtDate(n.reminder.at)}${n.reminder.freq !== 'once' ? ' · ' + n.reminder.freq : ''}</div>` : ''}
    ${n.tags.length ? `<div class="card-tags">${n.tags.map((id) => {
      const t = tagById(id);
      return t ? `<span class="card-tag" style="background:${t.color}">#${esc(t.name)}</span>` : '';
    }).join('')}</div>` : ''}
    ${n.title ? `<h3>${esc(n.title)}</h3>` : ''}
    ${n.text ? `<div class="body-text">${esc(n.text)}</div>` : ''}
  `;

  if (n.checklist.length) {
    const list = document.createElement('div');
    list.className = 'card-checklist';
    n.checklist.forEach((item, idx) => {
      const row = document.createElement('label');
      row.className = 'check-item' + (item.done ? ' done' : '');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = item.done;
      cb.onclick = async (e) => {
        e.stopPropagation();
        n.checklist[idx].done = cb.checked;
        await api.send('PUT', '/api/notes/' + n.id, { checklist: n.checklist });
        renderBoard();
      };
      const span = document.createElement('span');
      span.textContent = item.text;
      row.append(cb, span);
      list.appendChild(row);
    });
    card.appendChild(list);
    const prog = document.createElement('div');
    prog.className = 'check-progress';
    prog.textContent = `${done}/${n.checklist.length} done`;
    card.appendChild(prog);
  }

  if (n.images.length) {
    const imgs = document.createElement('div');
    imgs.className = 'card-images';
    for (const url of n.images) {
      const img = document.createElement('img');
      img.src = url;
      img.loading = 'lazy';
      imgs.appendChild(img);
    }
    card.appendChild(imgs);
  }

  if (n.done) {
    // two slightly offset strokes along the same bottom-left-to-top-right diagonal, like a
    // real marker's double pass — viewBox stretches to the card's actual box (preserveAspectRatio="none")
    // so it always reaches corner to corner no matter how tall the card's content makes it
    card.insertAdjacentHTML('beforeend', `
      <svg class="done-mark" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <path d="M 6,93 C 24,79 39,63 51,51 C 63,39 78,23 94,7" />
        <path d="M 7,92 C 23,80 38,61 50,52 C 65,37 79,21 93,8" />
      </svg>
    `);
  }

  card.onclick = (e) => {
    if (card._suppressClick) { card._suppressClick = false; return; }
    if (e.shiftKey || e.metaKey || e.ctrlKey) { e.stopPropagation(); toggleSelect(n.id, true); return; }
    openNoteModal(n);
  };
  return card;
}

/* ============ freeform board layout & drag ============ */
const BOARD_COL_W = 270;
const BOARD_GAP = 16;
const BOARD_GRID = 10;
const snapBoard = (v) => Math.max(0, Math.round(v / BOARD_GRID) * BOARD_GRID);

function boardTopZ() {
  const noteMax = Math.max(0, ...notes.map((n) => n.z || 1));
  const groupMax = Math.max(0, ...groups.map((g) => g.z || 1));
  return Math.max(noteMax, groupMax) + 1;
}

function layoutBoardHeight() {
  const board = $('board');
  let maxBottom = 0;
  // direct children only — a stack's inner .note-card would otherwise be
  // double-counted with an offsetTop relative to the stack, not the board
  for (const el of board.children) {
    if (el.classList.contains('note-card') || el.classList.contains('note-stack')) {
      maxBottom = Math.max(maxBottom, el.offsetTop + el.offsetHeight);
    }
  }
  board.style.height = Math.max(maxBottom + 24, 0) + 'px';
}

/* ============ drag-to-group (drop a card mostly on top of another to group them) ============ */
const dropHint = document.createElement('div');
dropHint.className = 'drop-hint';
dropHint.textContent = '🗂 Drop to group';
dropHint.hidden = true;
document.body.appendChild(dropHint);

function showDropHint(targetEl) {
  const r = targetEl.getBoundingClientRect();
  dropHint.style.left = r.left + r.width / 2 + 'px';
  dropHint.style.top = r.top - 8 + 'px';
  dropHint.hidden = false;
}
function hideDropHint() { dropHint.hidden = true; }

// finds the board item most covered by the dragged element, if any single item is
// covered more than half — used to offer "drop to group" while dragging a card/stack
function findGroupDropTarget(draggedEl, excludeId, excludeType, allowedTypes) {
  const dl = draggedEl.offsetLeft, dt = draggedEl.offsetTop;
  const dr = dl + draggedEl.offsetWidth, db = dt + draggedEl.offsetHeight;
  let best = null, bestRatio = 0.5; // must cover a strict majority of the candidate
  for (const it of navItems()) {
    if (it.id === excludeId && it.type === excludeType) continue;
    if (!allowedTypes.includes(it.type)) continue;
    const l = it.el.offsetLeft, t = it.el.offsetTop;
    const r = l + it.el.offsetWidth, b = t + it.el.offsetHeight;
    const ix = Math.max(0, Math.min(dr, r) - Math.max(dl, l));
    const iy = Math.max(0, Math.min(db, b) - Math.max(dt, t));
    const ratio = (ix * iy) / (it.el.offsetWidth * it.el.offsetHeight);
    if (ratio > bestRatio) { bestRatio = ratio; best = it; }
  }
  return best;
}

function attachNoteDrag(card, n) {
  let dragging = false, moved = false, start = null, group = null, dropTarget = null;

  const clearDropTarget = () => {
    if (!dropTarget) return;
    dropTarget.el.classList.remove('group-drop-target');
    dropTarget = null;
    hideDropHint();
  };

  card.addEventListener('pointerdown', (e) => {
    if (document.documentElement.dataset.ui === 'mobile') return;
    if (e.target.closest('button, input, a, img')) return;
    if (e.shiftKey || e.metaKey || e.ctrlKey) return; // modifier clicks toggle selection, not drag
    moved = false;
    dragging = true;
    start = { px: e.clientX, py: e.clientY };
    // dragging a selected card that's part of a bigger selection moves the whole group together
    group = (selectedNoteIds.has(n.id) && selectedNoteIds.size > 1)
      ? [...selectedNoteIds]
          .map((id) => ({ n: notes.find((x) => x.id === id), card: cardById.get(id) }))
          .filter((g) => g.n && g.card)
      : [{ n, card }];
    group.forEach((g) => { g.startX = g.n.x; g.startY = g.n.y; });
    try { card.setPointerCapture(e.pointerId); } catch {}
  });
  card.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - start.px, dy = e.clientY - start.py;
    if (!moved) {
      if (Math.hypot(dx, dy) < 5) return;
      moved = true;
      const z = boardTopZ();
      group.forEach((g) => { g.card.classList.add('dragging'); g.n.z = z; g.card.style.zIndex = z; });
    }
    group.forEach((g) => {
      g.n.x = snapBoard(Math.max(0, g.startX + dx));
      g.n.y = snapBoard(Math.max(0, g.startY + dy));
      g.card.style.left = g.n.x + 'px';
      g.card.style.top = g.n.y + 'px';
    });
    layoutBoardHeight();
    // dropping onto another card/stack only makes sense when dragging a single card
    if (group.length === 1) {
      const found = findGroupDropTarget(card, n.id, 'note', ['note', 'stack']);
      if (found !== dropTarget) {
        clearDropTarget();
        dropTarget = found;
        if (dropTarget) { dropTarget.el.classList.add('group-drop-target'); showDropHint(dropTarget.el); }
      } else if (dropTarget) {
        showDropHint(dropTarget.el); // keep the hint pinned to the target as both elements move
      }
    }
  });
  card.addEventListener('pointerup', async (e) => {
    if (!dragging) return;
    dragging = false;
    if (!moved) { group = null; return; }
    group.forEach((g) => g.card.classList.remove('dragging'));
    card._suppressClick = true; // swallow the click that would otherwise open the note right after a drag
    if (dropTarget) {
      const target = dropTarget;
      clearDropTarget();
      group = null;
      if (target.type === 'note') {
        await Promise.all([
          api.send('POST', '/api/groups', { noteIds: [n.id, target.id], x: target.el.offsetLeft, y: target.el.offsetTop, z: boardTopZ() }),
          // save where it was actually dropped, so an expanded view later doesn't snap it back to a stale spot
          api.send('PUT', '/api/notes/' + n.id, { x: n.x, y: n.y }),
        ]);
      } else {
        await api.send('PUT', '/api/notes/' + n.id, { groupId: target.id, x: n.x, y: n.y });
      }
      await loadData();
      return;
    }
    const toSave = group;
    group = null;
    await Promise.all(toSave.map((g) => api.send('PUT', '/api/notes/' + g.n.id, { x: g.n.x, y: g.n.y, z: g.n.z })));
  });
  card.addEventListener('pointercancel', () => { dragging = false; group = null; clearDropTarget(); });
}

/* ============ note groups (stacked decks) ============ */
function groupMembers(g) {
  return notes.filter((n) => n.groupId === g.id);
}

async function saveGroupName(g, inputEl) {
  const name = inputEl.value.trim();
  if (!name || name === g.name) { inputEl.value = g.name || ''; return; }
  g.name = name;
  await api.send('PUT', '/api/groups/' + g.id, { name });
}

// the stack's visible face is a title slide (renamable), not a preview of
// whichever member note happens to be on top — open the group to see those
function stackCard(g, members) {
  const wrap = document.createElement('div');
  wrap.className = 'note-stack';
  wrap.dataset.groupId = g.id;
  for (let i = 0; i < Math.min(2, members.length - 1); i++) {
    wrap.appendChild(document.createElement('div')).className = 'stack-peek';
  }
  const face = document.createElement('div');
  face.className = 'note-card stack-title-card';
  face.innerHTML = `
    <div class="stack-title-icon">🗂</div>
    <input class="stack-name-input" type="text" maxlength="60" placeholder="Untitled group" />
  `;
  const input = face.querySelector('.stack-name-input');
  input.value = g.name || '';
  input.addEventListener('pointerdown', (e) => e.stopPropagation());
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  input.addEventListener('blur', () => saveGroupName(g, input));
  wrap.appendChild(face);
  const badge = document.createElement('div');
  badge.className = 'stack-badge';
  badge.textContent = '🗂 ' + members.length;
  wrap.appendChild(badge);
  return wrap;
}

function attachStackDrag(el, g) {
  let dragging = false, moved = false, start = null, dropTarget = null;

  const clearDropTarget = () => {
    if (!dropTarget) return;
    dropTarget.el.classList.remove('group-drop-target');
    dropTarget = null;
    hideDropHint();
  };

  el.addEventListener('pointerdown', (e) => {
    if (document.documentElement.dataset.ui === 'mobile') return;
    if (e.target.closest('button, input, a, img')) return;
    moved = false;
    dragging = true;
    start = { px: e.clientX, py: e.clientY, x: g.x, y: g.y };
    try { el.setPointerCapture(e.pointerId); } catch {}
  });
  el.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - start.px, dy = e.clientY - start.py;
    if (!moved) {
      if (Math.hypot(dx, dy) < 5) return;
      moved = true;
      el.classList.add('dragging');
      g.z = boardTopZ();
      el.style.zIndex = g.z;
    }
    g.x = snapBoard(Math.max(0, start.x + dx));
    g.y = snapBoard(Math.max(0, start.y + dy));
    el.style.left = g.x + 'px';
    el.style.top = g.y + 'px';
    layoutBoardHeight();
    // a stack can only absorb a loose note by dropping onto it — merging two
    // stacks together isn't supported yet, so only note cards count as targets
    const found = findGroupDropTarget(el, g.id, 'stack', ['note']);
    if (found !== dropTarget) {
      clearDropTarget();
      dropTarget = found;
      if (dropTarget) { dropTarget.el.classList.add('group-drop-target'); showDropHint(dropTarget.el); }
    } else if (dropTarget) {
      showDropHint(dropTarget.el);
    }
  });
  el.addEventListener('pointerup', async () => {
    if (!dragging) return;
    dragging = false;
    if (!moved) { openGroupModal(g); return; }
    el.classList.remove('dragging');
    if (dropTarget) {
      const target = dropTarget;
      clearDropTarget();
      await Promise.all([
        api.send('PUT', '/api/groups/' + g.id, { x: g.x, y: g.y, z: g.z }),
        api.send('PUT', '/api/notes/' + target.id, { groupId: g.id }),
      ]);
      await loadData();
      return;
    }
    await api.send('PUT', '/api/groups/' + g.id, { x: g.x, y: g.y, z: g.z });
  });
  el.addEventListener('pointercancel', () => { dragging = false; clearDropTarget(); });
}

function openGroupModal(g) {
  const members = groupMembers(g);
  const titleInput = $('groupModalTitle');
  titleInput.value = g.name || '';
  titleInput.onblur = () => saveGroupName(g, titleInput);
  titleInput.onkeydown = (e) => { if (e.key === 'Enter') titleInput.blur(); };
  $('groupModalCount').textContent = `${members.length} note${members.length === 1 ? '' : 's'}`;
  const list = $('groupList');
  list.innerHTML = '';
  members
    .slice()
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .forEach((n) => {
      const wrap = document.createElement('div');
      wrap.className = 'group-card-wrap';
      const card = noteCard(n);
      card.onclick = (e) => {
        if (e.shiftKey || e.metaKey || e.ctrlKey) { e.stopPropagation(); toggleSelect(n.id, true); return; }
        closeGroupModal();
        openNoteModal(n);
      };
      wrap.appendChild(card);
      const rm = document.createElement('button');
      rm.className = 'group-card-remove';
      rm.title = 'Take this note out of the group';
      rm.textContent = '✕';
      rm.onclick = async (e) => {
        e.stopPropagation();
        await api.send('PUT', '/api/notes/' + n.id, { groupId: null });
        await loadData();
        const stillGroup = groups.find((x) => x.id === g.id);
        if (stillGroup) openGroupModal(stillGroup); else closeGroupModal();
      };
      wrap.appendChild(rm);
      list.appendChild(wrap);
    });
  $('ungroupBtn').onclick = async () => {
    await api.send('DELETE', '/api/groups/' + g.id);
    closeGroupModal();
    await loadData();
  };
  $('groupModal').hidden = false;
}
function closeGroupModal() { $('groupModal').hidden = true; }
$('closeGroupModal').onclick = closeGroupModal;
$('closeGroupModalBtn').onclick = closeGroupModal;
$('groupModal').addEventListener('mousedown', (e) => { if (e.target === $('groupModal')) closeGroupModal(); });

async function groupSelectedNotes() {
  const ids = [...selectedNoteIds];
  if (ids.length < 2) return;
  const picked = notes.filter((n) => ids.includes(n.id) && n.x != null && n.y != null);
  const x = picked.length ? Math.min(...picked.map((n) => n.x)) : 20;
  const y = picked.length ? Math.min(...picked.map((n) => n.y)) : 20;
  clearSelection();
  await api.send('POST', '/api/groups', { noteIds: ids, x, y, z: boardTopZ() });
  await loadData();
}

/* ============ multi-select ============ */
const selectionBar = document.createElement('div');
selectionBar.className = 'selection-bar';
selectionBar.hidden = true;
document.body.appendChild(selectionBar);

function refreshSelectionUI() {
  cardById.forEach((card, id) => card.classList.toggle('selected', selectedNoteIds.has(id)));
  const count = selectedNoteIds.size;
  if (!count) { selectionBar.hidden = true; return; }
  selectionBar.hidden = false;
  selectionBar.innerHTML = `
    <span>${count} selected</span>
    ${count >= 2 ? '<button class="tool-btn sel-group">🗂 Group</button>' : ''}
    <button class="tool-btn sel-delete">🗑 Delete</button>
    <button class="tool-btn sel-clear">✕ Clear</button>`;
  if (count >= 2) selectionBar.querySelector('.sel-group').onclick = () => groupSelectedNotes();
  selectionBar.querySelector('.sel-delete').onclick = async () => {
    if (!confirmDestructive(`Delete ${count} note${count === 1 ? '' : 's'}?`)) return;
    const ids = [...selectedNoteIds];
    clearSelection();
    await Promise.all(ids.map((id) => api.send('DELETE', '/api/notes/' + id)));
    await loadData();
  };
  selectionBar.querySelector('.sel-clear').onclick = () => clearSelection();
}
function toggleSelect(id, additive) {
  if (!additive) selectedNoteIds.clear();
  if (selectedNoteIds.has(id)) selectedNoteIds.delete(id); else selectedNoteIds.add(id);
  refreshSelectionUI();
}
function clearSelection() {
  if (!selectedNoteIds.size) return;
  selectedNoteIds.clear();
  refreshSelectionUI();
}

// rubber-band select: drag on empty board space to select every note it touches
function attachMarquee(board) {
  let marqueeStart = null, marqueeEl = null, base = null;
  board.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.note-card') || e.button !== 0) return;
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    if (!additive) clearSelection();
    base = new Set(selectedNoteIds);
    const rect = board.getBoundingClientRect();
    marqueeStart = { clientX: e.clientX, clientY: e.clientY, boardX: e.clientX - rect.left, boardY: e.clientY - rect.top };
    try { board.setPointerCapture(e.pointerId); } catch {}
  });
  board.addEventListener('pointermove', (e) => {
    if (!marqueeStart) return;
    const dx = e.clientX - marqueeStart.clientX, dy = e.clientY - marqueeStart.clientY;
    if (!marqueeEl) {
      if (Math.hypot(dx, dy) < 4) return;
      marqueeEl = document.createElement('div');
      marqueeEl.className = 'board-marquee';
      document.body.appendChild(marqueeEl);
    }
    const x0 = Math.min(marqueeStart.clientX, e.clientX), y0 = Math.min(marqueeStart.clientY, e.clientY);
    marqueeEl.style.left = x0 + 'px';
    marqueeEl.style.top = y0 + 'px';
    marqueeEl.style.width = Math.abs(dx) + 'px';
    marqueeEl.style.height = Math.abs(dy) + 'px';

    const rect = board.getBoundingClientRect();
    const bx = e.clientX - rect.left, by = e.clientY - rect.top;
    const bx0 = Math.min(marqueeStart.boardX, bx), bx1 = Math.max(marqueeStart.boardX, bx);
    const by0 = Math.min(marqueeStart.boardY, by), by1 = Math.max(marqueeStart.boardY, by);
    const hit = new Set();
    cardById.forEach((card, id) => {
      const cx0 = card.offsetLeft, cy0 = card.offsetTop;
      if (cx0 < bx1 && cx0 + card.offsetWidth > bx0 && cy0 < by1 && cy0 + card.offsetHeight > by0) hit.add(id);
    });
    selectedNoteIds = new Set([...base, ...hit]);
    refreshSelectionUI();
  });
  const end = () => { marqueeStart = null; base = null; if (marqueeEl) { marqueeEl.remove(); marqueeEl = null; } };
  board.addEventListener('pointerup', end);
  board.addEventListener('pointercancel', end);
}

// place notes without a saved position into the shortest column below
// whatever's already anchored, mirroring how the old masonry layout read
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

  // pinned-first so a fresh board still reads with pins up top, like before
  unpositioned.sort((a, b) => (b.n.pinned - a.n.pinned));

  const toPersist = [];
  unpositioned.forEach(({ n, card }) => {
    let col = 0;
    for (let i = 1; i < cols; i++) if (colHeights[i] < colHeights[col]) col = i;
    n.x = col * (BOARD_COL_W + BOARD_GAP);
    n.y = colHeights[col];
    n.z = n.z || 1;
    card.style.left = n.x + 'px';
    card.style.top = n.y + 'px';
    colHeights[col] = n.y + card.offsetHeight + BOARD_GAP;
    toPersist.push(n);
  });

  toPersist.forEach((n) => api.send('PUT', '/api/notes/' + n.id, { x: n.x, y: n.y, z: n.z }).catch(() => {}));
}

/* ============ vim-style (hjkl) board navigation ============ */
function navItems() {
  const board = $('board');
  const items = [];
  for (const el of board.children) {
    if (el.classList.contains('note-card')) items.push({ id: el.dataset.id, type: 'note', el });
    else if (el.classList.contains('note-stack')) items.push({ id: el.dataset.groupId, type: 'stack', el });
  }
  return items.map((it) => ({
    ...it,
    cx: it.el.offsetLeft + it.el.offsetWidth / 2,
    cy: it.el.offsetTop + it.el.offsetHeight / 2,
  }));
}

function setKbdFocus(item) {
  $('board').querySelectorAll('.kbd-focus').forEach((el) => el.classList.remove('kbd-focus'));
  kbdFocus = item ? { id: item.id, type: item.type } : null;
  if (item) {
    item.el.classList.add('kbd-focus');
    item.el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }
}

// re-applies the .kbd-focus class after a re-render (renderBoard rebuilds every card),
// or drops focus quietly if that note/stack no longer exists (deleted, filtered out, etc.)
function restoreKbdFocus() {
  if (!kbdFocus) return;
  const items = navItems();
  const match = items.find((it) => it.id === kbdFocus.id && it.type === kbdFocus.type);
  if (match) match.el.classList.add('kbd-focus');
  else kbdFocus = null;
}

function navigate(dir) {
  const items = navItems();
  if (!items.length) return;
  const current = kbdFocus && items.find((it) => it.id === kbdFocus.id && it.type === kbdFocus.type);
  if (!current) {
    // nothing focused yet — start at the topmost, then leftmost, card
    const first = items.slice().sort((a, b) => (a.cy - b.cy) || (a.cx - b.cx))[0];
    setKbdFocus(first);
    return;
  }
  let best = null, bestScore = Infinity;
  for (const it of items) {
    if (it === current) continue;
    const dx = it.cx - current.cx, dy = it.cy - current.cy;
    let primary, perp;
    if (dir === 'l') { if (dx <= 0) continue; primary = dx; perp = dy; }
    else if (dir === 'h') { if (dx >= 0) continue; primary = -dx; perp = dy; }
    else if (dir === 'j') { if (dy <= 0) continue; primary = dy; perp = dx; }
    else { if (dy >= 0) continue; primary = -dy; perp = dx; }
    const score = primary + Math.abs(perp) * 2; // weight off-axis distance so same row/column wins over diagonals
    if (score < bestScore) { bestScore = score; best = it; }
  }
  if (best) setKbdFocus(best);
}

function anyModalOpen() {
  return !$('noteModal').hidden || !$('tagModal').hidden || !$('groupModal').hidden ||
    !$('widgetConfigModal').hidden || !$('wbOverlay').hidden;
}

function openKbdFocused() {
  if (!kbdFocus) return;
  if (kbdFocus.type === 'note') {
    const n = notes.find((x) => x.id === kbdFocus.id);
    if (n) openNoteModal(n);
  } else {
    const g = groups.find((x) => x.id === kbdFocus.id);
    if (g) openGroupModal(g);
  }
}

function renderBoard() {
  const board = $('board');
  board.innerHTML = '';
  board.style.height = '';
  cardById.clear();
  const filtering = !!(activeTagIds.size || searchQuery);
  const ungrouped = notes.filter((n) => !n.groupId && noteMatches(n));
  const visibleGroups = groups
    .map((g) => ({ g, members: groupMembers(g) }))
    .filter(({ members }) => members.length >= 2 && (!filtering || members.some(noteMatches)));

  $('emptyState').hidden = notes.length > 0;

  if (notes.length && !ungrouped.length && !visibleGroups.length) {
    const none = document.createElement('p');
    none.className = 'muted';
    none.textContent = 'No notes match your search.';
    board.appendChild(none);
    return;
  }

  const entries = ungrouped.map((n) => {
    const card = noteCard(n);
    const hasPos = n.x != null && n.y != null;
    card.style.left = (hasPos ? n.x : 0) + 'px';
    card.style.top = (hasPos ? n.y : 0) + 'px';
    card.style.zIndex = n.z || 1;
    if (!hasPos) card.style.visibility = 'hidden'; // only unplaced cards need the measure-then-place pass
    board.appendChild(card);
    cardById.set(n.id, card);
    attachNoteDrag(card, n);
    return { n, card, hasPos };
  });

  visibleGroups.forEach(({ g, members }) => {
    const el = stackCard(g, members);
    el.style.left = (g.x ?? 20) + 'px';
    el.style.top = (g.y ?? 20) + 'px';
    el.style.zIndex = g.z || 1;
    board.appendChild(el);
    attachStackDrag(el, g);
  });

  restoreKbdFocus();

  if (entries.some((e) => !e.hasPos)) {
    requestAnimationFrame(() => {
      placeUnpositioned(board, entries);
      entries.forEach(({ card }) => (card.style.visibility = ''));
      layoutBoardHeight();
    });
  } else {
    layoutBoardHeight();
  }
}

/* ============ search ============ */
$('searchInput').oninput = (e) => {
  searchQuery = e.target.value.trim();
  e.target.parentElement.classList.toggle('has-text', !!searchQuery);
  renderBoard();
};
$('clearSearch').onclick = () => {
  $('searchInput').value = '';
  searchQuery = '';
  $('searchInput').parentElement.classList.remove('has-text');
  renderBoard();
};

/* ============ note modal ============ */
function openNoteModal(n) {
  editingIsNew = !n;
  editingNote = n
    ? JSON.parse(JSON.stringify(n))
    : { title: '', text: '', checklist: [], tags: [], color: '', textColor: '', images: [], pinned: false, done: false };
  editingMode = editingNote.checklist.length ? 'list' : 'note';

  $('noteModalDates').textContent = n
    ? `Created ${fmtDate(n.createdAt)}${n.updatedAt !== n.createdAt ? ' · Edited ' + fmtDate(n.updatedAt) : ''}`
    : 'New note';
  $('noteTitle').value = editingNote.title;
  $('noteText').value = editingNote.text;
  $('deleteNoteBtn').style.display = editingIsNew ? 'none' : '';
  updatePinBtn();
  updateDoneBtn();
  loadReminderEditor();
  setMode(editingMode);
  renderChecklistEditor();
  renderNoteImages();
  renderTagPicker();
  renderSwatches();
  $('noteModal').hidden = false;
  $('noteTitle').focus();
}

function closeNoteModal() {
  $('noteModal').hidden = true;
  editingNote = null;
}

function setMode(mode) {
  editingMode = mode;
  $('modeNote').classList.toggle('active', mode === 'note');
  $('modeList').classList.toggle('active', mode === 'list');
  $('noteText').hidden = false; // text always available
  $('checklistEditor').hidden = mode !== 'list';
  if (mode === 'list' && editingNote.checklist.length === 0) addChecklistItem();
}
$('modeNote').onclick = () => setMode('note');
$('modeList').onclick = () => setMode('list');

function updatePinBtn() {
  $('pinNoteBtn').classList.toggle('pinned-active', editingNote.pinned);
  $('pinNoteBtn').textContent = editingNote.pinned ? '📌 Pinned' : '📌 Pin';
}
$('pinNoteBtn').onclick = () => {
  editingNote.pinned = !editingNote.pinned;
  updatePinBtn();
};

function updateDoneBtn() {
  $('doneNoteBtn').classList.toggle('pinned-active', editingNote.done);
  $('doneNoteBtn').textContent = editingNote.done ? '✓ Done' : '☐ Mark done';
}
$('doneNoteBtn').onclick = () => {
  editingNote.done = !editingNote.done;
  updateDoneBtn();
};

/* --- reminder editor --- */
function loadReminderEditor() {
  const r = editingNote.reminder;
  const on = !!(r && r.enabled);
  $('reminderToggle').classList.toggle('active', on);
  $('reminderEditor').hidden = !on;
  if (on) {
    const d = new Date(r.at);
    $('reminderDate').value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    $('reminderTime').value = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    $('reminderFreq').value = r.freq || 'once';
  }
}
function defaultReminderTime() {
  const d = new Date(Date.now() + 60 * 60 * 1000); // one hour from now
  d.setMinutes(0, 0, 0);
  return d;
}
$('reminderToggle').onclick = () => {
  const on = $('reminderEditor').hidden;
  $('reminderEditor').hidden = !on;
  $('reminderToggle').classList.toggle('active', on);
  if (on && !$('reminderDate').value) {
    const d = defaultReminderTime();
    $('reminderDate').value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    $('reminderTime').value = `${String(d.getHours()).padStart(2, '0')}:00`;
  }
};
$('reminderClear').onclick = () => {
  $('reminderEditor').hidden = true;
  $('reminderToggle').classList.remove('active');
  $('reminderDate').value = '';
  $('reminderTime').value = '';
};
function readReminder() {
  if ($('reminderEditor').hidden || !$('reminderDate').value || !$('reminderTime').value) return null;
  const [y, m, d] = $('reminderDate').value.split('-').map(Number);
  const [hh, mm] = $('reminderTime').value.split(':').map(Number);
  return {
    at: new Date(y, m - 1, d, hh, mm).toISOString(),
    freq: $('reminderFreq').value,
    enabled: true,
  };
}

/* --- checklist editor --- */
function renderChecklistEditor() {
  const wrap = $('checklistItems');
  wrap.innerHTML = '';
  editingNote.checklist.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'checklist-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = item.done;
    cb.onchange = () => (editingNote.checklist[idx].done = cb.checked);
    const txt = document.createElement('input');
    txt.type = 'text';
    txt.value = item.text;
    txt.placeholder = 'Item ' + (idx + 1);
    txt.oninput = () => (editingNote.checklist[idx].text = txt.value);
    txt.onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addChecklistItem(); }
    };
    const rm = document.createElement('button');
    rm.className = 'remove-item';
    rm.textContent = '✕';
    rm.onclick = () => {
      editingNote.checklist.splice(idx, 1);
      renderChecklistEditor();
    };
    row.append(cb, txt, rm);
    wrap.appendChild(row);
  });
}
function addChecklistItem() {
  editingNote.checklist.push({ text: '', done: false });
  renderChecklistEditor();
  const inputs = $('checklistItems').querySelectorAll('input[type=text]');
  inputs[inputs.length - 1]?.focus();
}
$('addChecklistItem').onclick = addChecklistItem;

/* --- images --- */
function renderNoteImages() {
  const wrap = $('noteImages');
  wrap.innerHTML = '';
  editingNote.images.forEach((url, idx) => {
    const div = document.createElement('div');
    div.className = 'img-thumb';
    div.innerHTML = `<img src="${url}" />`;
    const rm = document.createElement('button');
    rm.className = 'remove-img';
    rm.textContent = '✕';
    rm.title = 'Remove image';
    rm.onclick = () => {
      editingNote.images.splice(idx, 1);
      renderNoteImages();
    };
    div.appendChild(rm);
    wrap.appendChild(div);
  });
}
$('imageUpload').onchange = async (e) => {
  for (const file of e.target.files) {
    const fd = new FormData();
    fd.append('image', file);
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      if (!res.ok) throw new Error('upload failed');
      const { url } = await res.json();
      editingNote.images.push(url);
    } catch {
      alert('Image upload failed: ' + file.name);
    }
  }
  e.target.value = '';
  renderNoteImages();
};

/* --- tag picker --- */
function renderTagPicker() {
  const wrap = $('noteTagPicker');
  wrap.innerHTML = '';
  if (!tags.length) {
    wrap.innerHTML = '<span class="muted small">No tags yet — create one from the dashboard.</span>';
    return;
  }
  for (const t of tags) {
    const btn = document.createElement('button');
    const on = editingNote.tags.includes(t.id);
    btn.className = 'tag-chip' + (on ? ' active' : '');
    btn.innerHTML = `<span class="dot" style="background:${t.color}"></span>#${esc(t.name)}`;
    btn.onclick = () => {
      const i = editingNote.tags.indexOf(t.id);
      i >= 0 ? editingNote.tags.splice(i, 1) : editingNote.tags.push(t.id);
      renderTagPicker();
    };
    wrap.appendChild(btn);
  }
}

/* --- color swatches --- */
function swatchRow(container, colors, selected, onPick) {
  container.innerHTML = '';
  const none = document.createElement('button');
  none.className = 'swatch none' + (!selected ? ' selected' : '');
  none.textContent = '∅';
  none.title = 'Default';
  none.onclick = () => onPick('');
  container.appendChild(none);
  for (const c of colors) {
    const b = document.createElement('button');
    b.className = 'swatch' + (selected === c ? ' selected' : '');
    b.style.background = c;
    b.onclick = () => onPick(c);
    container.appendChild(b);
  }
}
function renderSwatches() {
  swatchRow($('outlineColors'), OUTLINE_COLORS, editingNote.color, (c) => {
    editingNote.color = c;
    renderSwatches();
  });
  swatchRow($('textColors'), TEXT_COLORS, editingNote.textColor, (c) => {
    editingNote.textColor = c;
    renderSwatches();
  });
}

/* --- save / delete --- */
$('saveNoteBtn').onclick = async () => {
  editingNote.title = $('noteTitle').value.trim();
  editingNote.text = $('noteText').value;
  editingNote.checklist = editingNote.checklist.filter((c) => c.text.trim());
  editingNote.reminder = readReminder();
  if (!editingNote.title && !editingNote.text.trim() && !editingNote.checklist.length && !editingNote.images.length) {
    closeNoteModal();
    return;
  }
  if (editingIsNew) {
    editingNote.z = boardTopZ(); // always land on top — a new card behind an older, higher-z one looks like it never got created
    await api.send('POST', '/api/notes', editingNote);
  } else {
    await api.send('PUT', '/api/notes/' + editingNote.id, editingNote);
  }
  closeNoteModal();
  await loadData();
};
$('deleteNoteBtn').onclick = async () => {
  if (!confirmDestructive('Delete this note?')) return;
  await api.send('DELETE', '/api/notes/' + editingNote.id);
  closeNoteModal();
  await loadData();
};
$('cancelNoteBtn').onclick = closeNoteModal;
$('closeNoteModal').onclick = closeNoteModal;
$('addNoteBtn').onclick = () => openNoteModal(null);

/* ============ tag modal ============ */
function openTagModal(mode) {
  $('tagModalTitle').textContent = mode === 'create' ? 'Add Tag' : 'Edit Tags';
  $('tagCreateSection').hidden = mode !== 'create';
  $('tagEditSection').hidden = mode !== 'edit';
  if (mode === 'create') {
    $('tagNameInput').value = '';
    newTagColor = TAG_COLORS[0];
    openTagModalColorRefresh();
  } else {
    renderTagEditList();
  }
  $('tagModal').hidden = false;
  if (mode === 'create') $('tagNameInput').focus();
}
function openTagModalColorRefresh() {
  swatchRowSimple($('tagColorRow'), TAG_COLORS, newTagColor, (c) => {
    newTagColor = c;
    openTagModalColorRefresh();
  });
}
function swatchRowSimple(container, colors, selected, onPick) {
  container.innerHTML = '';
  for (const c of colors) {
    const b = document.createElement('button');
    b.className = 'swatch' + (selected === c ? ' selected' : '');
    b.style.background = c;
    b.onclick = () => onPick(c);
    container.appendChild(b);
  }
}
function closeTagModal() { $('tagModal').hidden = true; }
$('closeTagModal').onclick = closeTagModal;
$('addTagBtn').onclick = () => openTagModal('create');
$('editTagsBtn').onclick = () => openTagModal('edit');

$('createTagBtn').onclick = async () => {
  const name = $('tagNameInput').value.trim();
  if (!name) return;
  try {
    await api.send('POST', '/api/tags', { name, color: newTagColor });
    closeTagModal();
    await loadData();
  } catch (err) {
    alert(err.message);
  }
};
$('tagNameInput').onkeydown = (e) => { if (e.key === 'Enter') $('createTagBtn').click(); };

function renderTagEditList() {
  const wrap = $('tagEditList');
  wrap.innerHTML = '';
  if (!tags.length) {
    wrap.innerHTML = '<p class="muted small">No tags yet.</p>';
    return;
  }
  for (const t of tags) {
    const row = document.createElement('div');
    row.className = 'tag-edit-row';

    const color = document.createElement('input');
    color.type = 'color';
    color.value = t.color;
    color.title = 'Tag color';
    color.onchange = async () => {
      await api.send('PUT', '/api/tags/' + t.id, { color: color.value });
      await loadData();
      renderTagEditList();
    };

    const name = document.createElement('input');
    name.type = 'text';
    name.value = '#' + t.name;
    name.onchange = async () => {
      const v = name.value.trim();
      if (!v) { name.value = '#' + t.name; return; }
      await api.send('PUT', '/api/tags/' + t.id, { name: v });
      await loadData();
      renderTagEditList();
    };

    const pin = document.createElement('button');
    pin.className = 'mini-btn' + (t.pinned ? ' pin-on' : '');
    pin.textContent = '📌';
    pin.title = t.pinned ? 'Unpin tag' : 'Pin tag (shows first in the tag bar)';
    pin.onclick = async () => {
      await api.send('PUT', '/api/tags/' + t.id, { pinned: !t.pinned });
      await loadData();
      renderTagEditList();
    };

    const del = document.createElement('button');
    del.className = 'mini-btn danger';
    del.textContent = '🗑';
    del.title = 'Delete tag';
    del.onclick = async () => {
      if (!confirmDestructive(`Delete tag #${t.name}? It will be removed from all notes.`)) return;
      await api.send('DELETE', '/api/tags/' + t.id);
      activeTagIds.delete(t.id);
      await loadData();
      renderTagEditList();
    };

    row.append(color, name, pin, del);
    wrap.appendChild(row);
  }
}

/* ============ global ============ */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeNoteModal(); closeTagModal(); setKbdFocus(null); }
  // Cmd/Ctrl+N — browsers reserve this for "new window" in a normal tab, so
  // this only actually fires when DJBoard is installed as a PWA
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
    if (e.target.closest('input, textarea, select, [contenteditable]')) return;
    e.preventDefault();
    openNoteModal(null);
  }
  // vim-style hjkl board navigation + Enter to open the focused card
  if (!e.metaKey && !e.ctrlKey && !e.altKey && 'hjklHJKL'.includes(e.key)) {
    if (e.target.closest('input, textarea, select, [contenteditable]') || anyModalOpen()) return;
    e.preventDefault();
    navigate(e.key.toLowerCase());
  }
  if (e.key === 'Enter' && kbdFocus) {
    if (e.target.closest('input, textarea, select, [contenteditable]') || anyModalOpen()) return;
    e.preventDefault();
    openKbdFocused();
  }
});
$('noteModal').addEventListener('mousedown', (e) => { if (e.target === $('noteModal')) closeNoteModal(); });
$('tagModal').addEventListener('mousedown', (e) => { if (e.target === $('tagModal')) closeTagModal(); });

/* ============ right-click context menus ============ */
const ctxMenu = document.createElement('div');
ctxMenu.className = 'ctx-menu';
ctxMenu.hidden = true;
document.body.appendChild(ctxMenu);

function hideCtx() { ctxMenu.hidden = true; }
document.addEventListener('click', hideCtx);
document.addEventListener('scroll', hideCtx, true);
window.addEventListener('resize', hideCtx);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { hideCtx(); clearSelection(); } });

function showCtx(x, y, items) {
  ctxMenu.innerHTML = '';
  for (const item of items) {
    if (item.sep) {
      const s = document.createElement('div');
      s.className = 'ctx-sep';
      ctxMenu.appendChild(s);
      continue;
    }
    if (item.custom) { ctxMenu.appendChild(item.custom); continue; }
    const btn = document.createElement('button');
    btn.className = 'ctx-item' + (item.danger ? ' danger' : '');
    btn.innerHTML = item.label;
    btn.onclick = (e) => { e.stopPropagation(); hideCtx(); item.onclick(); };
    ctxMenu.appendChild(btn);
  }
  ctxMenu.hidden = false;
  const mw = ctxMenu.offsetWidth, mh = ctxMenu.offsetHeight;
  ctxMenu.style.left = Math.min(x, window.innerWidth - mw - 8) + 'px';
  ctxMenu.style.top = Math.min(y, window.innerHeight - mh - 8) + 'px';
}

function colorSwatchMenuRow(current, onPick) {
  const row = document.createElement('div');
  row.className = 'ctx-swatches';
  const none = document.createElement('button');
  none.className = 'swatch none' + (!current ? ' selected' : '');
  none.textContent = '∅';
  none.onclick = (e) => { e.stopPropagation(); hideCtx(); onPick(''); };
  row.appendChild(none);
  for (const c of OUTLINE_COLORS) {
    const b = document.createElement('button');
    b.className = 'swatch' + (current === c ? ' selected' : '');
    b.style.background = c;
    b.onclick = (e) => { e.stopPropagation(); hideCtx(); onPick(c); };
    row.appendChild(b);
  }
  return row;
}

function noteCtxItems(n) {
  const items = [
    {
      label: n.pinned ? '📌 Unpin note' : '📌 Pin note',
      onclick: async () => {
        await api.send('PUT', '/api/notes/' + n.id, { pinned: !n.pinned });
        await loadData();
      },
    },
    {
      label: n.done ? '☐ Mark not done' : '✓ Mark done',
      onclick: async () => {
        await api.send('PUT', '/api/notes/' + n.id, { done: !n.done });
        await loadData();
      },
    },
    {
      label: '🎨 Outline color…',
      onclick: () => {
        showCtx(parseFloat(ctxMenu.style.left), parseFloat(ctxMenu.style.top), [
          { custom: colorSwatchMenuRow(n.color, async (c) => {
            await api.send('PUT', '/api/notes/' + n.id, { color: c });
            await loadData();
          }) },
        ]);
      },
    },
    {
      label: n.reminder?.enabled ? '⏰ Edit reminder…' : '⏰ Add to calendar / remind…',
      onclick: () => {
        openNoteModal(n);
        if ($('reminderEditor').hidden) $('reminderToggle').click();
        $('reminderEditor').classList.add('flash');
        setTimeout(() => $('reminderEditor').classList.remove('flash'), 1200);
      },
    },
  ];
  // only reachable via right-click inside the group modal — grouped notes aren't individually on the board
  if (n.groupId) {
    const gid = n.groupId;
    items.push({
      label: '↗ Remove from group',
      onclick: async () => {
        await api.send('PUT', '/api/notes/' + n.id, { groupId: null });
        await loadData();
        const stillGroup = groups.find((x) => x.id === gid);
        if (stillGroup) openGroupModal(stillGroup); else closeGroupModal();
      },
    });
  }
  items.push(
    { label: '✏️ Edit note', onclick: () => openNoteModal(n) },
    { sep: true },
    {
      label: '🗑 Delete note',
      danger: true,
      onclick: async () => {
        if (!confirmDestructive('Delete this note?')) return;
        await api.send('DELETE', '/api/notes/' + n.id);
        await loadData();
      },
    },
  );
  return items;
}

function groupCtxItems() {
  const count = selectedNoteIds.size;
  return [
    { label: `🗂 Group ${count} notes`, onclick: () => groupSelectedNotes() },
    { sep: true },
    {
      label: `🗑 Delete ${count} notes`,
      danger: true,
      onclick: async () => {
        if (!confirmDestructive(`Delete ${count} notes?`)) return;
        const ids = [...selectedNoteIds];
        clearSelection();
        await Promise.all(ids.map((id) => api.send('DELETE', '/api/notes/' + id)));
        await loadData();
      },
    },
    { sep: true },
    { label: '✕ Clear selection', onclick: () => clearSelection() },
  ];
}

function stackCtxItems(g) {
  const count = groupMembers(g).length;
  return [
    { label: `📂 Open group (${count})`, onclick: () => openGroupModal(g) },
    { sep: true },
    {
      label: '💥 Ungroup',
      onclick: async () => {
        await api.send('DELETE', '/api/groups/' + g.id);
        await loadData();
      },
    },
  ];
}

function widgetCtxItems(id) {
  const items = [];
  if (window.WidgetAPI?.hasConfig(id)) {
    items.push({ label: '⚙ Widget settings…', onclick: () => window.WidgetAPI.openConfig(id) });
  }
  items.push({ label: '⊞ Edit widget layout', onclick: () => window.WidgetAPI?.toggleEdit() });
  items.push({ sep: true });
  items.push({
    label: '✕ Remove widget',
    danger: true,
    onclick: () => window.WidgetAPI?.remove(id),
  });
  return items;
}

function backgroundCtxItems() {
  return [
    { label: '➕ New note', onclick: () => openNoteModal(null) },
    { label: '# New tag', onclick: () => openTagModal('create') },
    { label: '⊞ Edit widgets', onclick: () => window.WidgetAPI?.toggleEdit() },
    { sep: true },
    { label: '◐ Toggle light / dark', onclick: () => $('themeToggle').click() },
    { label: '📺 Display mode', onclick: () => (location.href = 'display.html') },
    {
      label: confirmDeleteEnabled() ? '🛡 Confirm before delete: On' : '🛡 Confirm before delete: Off',
      onclick: () => localStorage.setItem('mb-confirm-delete', confirmDeleteEnabled() ? '0' : '1'),
    },
  ];
}

document.addEventListener('contextmenu', (e) => {
  // keep the native menu inside text fields and on links/images
  if (e.target.closest('input, textarea, select, a, [contenteditable]')) return;
  if (e.target.closest('.modal-overlay, .wb-overlay')) return;
  e.preventDefault();
  const stackEl = e.target.closest('.note-stack');
  if (stackEl) {
    const g = groups.find((x) => x.id === stackEl.dataset.groupId);
    if (g) return showCtx(e.clientX, e.clientY, stackCtxItems(g));
  }
  const noteEl = e.target.closest('.note-card');
  if (noteEl) {
    const n = notes.find((x) => x.id === noteEl.dataset.id);
    if (n) {
      if (selectedNoteIds.has(n.id) && selectedNoteIds.size > 1) return showCtx(e.clientX, e.clientY, groupCtxItems());
      return showCtx(e.clientX, e.clientY, noteCtxItems(n));
    }
  }
  const widgetEl = e.target.closest('.widget');
  if (widgetEl) return showCtx(e.clientX, e.clientY, widgetCtxItems(widgetEl.dataset.id));
  showCtx(e.clientX, e.clientY, backgroundCtxItems());
});

async function loadData() {
  [notes, tags, groups] = await Promise.all([api.get('/api/notes'), api.get('/api/tags'), api.get('/api/groups')]);
  renderTagRow();
  renderBoard();
}

attachMarquee($('board'));
applyPrefs();
loadData();
