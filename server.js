require('dotenv').config({ quiet: true });

const express = require('express');
const session = require('express-session');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3113;

// ---------- single-user auth ----------
// Set AUTH_PASSWORD to require a login before the board (and its API) can be
// used. Leave it unset to keep the old no-auth behavior (e.g. VPN-only setups).
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || '';
const AUTH_ENABLED = !!AUTH_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const PUBLIC_PATHS = new Set(['/login.html', '/api/login', '/api/session']);
// Lets a trusted kiosk device (e.g. the Pi driving the TV) skip the login
// page entirely: /display.html?kiosk=<token> logs the session in the same
// way a password would. Grants full access, same as AUTH_PASSWORD — only
// put it in places you physically control. See deploy/README.md.
const KIOSK_TOKEN = process.env.KIOSK_TOKEN || '';

if (AUTH_ENABLED && !process.env.SESSION_SECRET) {
  console.log('Note: SESSION_SECRET not set — using a random secret, so sessions won\'t survive a restart.');
}
if (!AUTH_ENABLED) {
  console.log('Auth disabled (set AUTH_PASSWORD to require a login).');
}

function safeEqual(input, expected) {
  const a = Buffer.from(String(input));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function checkPassword(input) {
  return safeEqual(input, AUTH_PASSWORD);
}

function requireAuth(req, res, next) {
  if (!AUTH_ENABLED || req.session.authed || PUBLIC_PATHS.has(req.path)) return next();
  if (KIOSK_TOKEN && typeof req.query.kiosk === 'string' && safeEqual(req.query.kiosk, KIOSK_TOKEN)) {
    req.session.authed = true;
    return next();
  }
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
  return res.redirect('/login.html?next=' + encodeURIComponent(req.originalUrl));
}

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------- tiny JSON file DB ----------
function loadDb() {
  try {
    const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    db.widgets = db.widgets || [];
    db.settings = db.settings || {};
    db.reminders = db.reminders || [];
    db.groups = db.groups || [];
    return db;
  } catch {
    return { notes: [], tags: [], widgets: [], settings: {}, reminders: [], groups: [] };
  }
}
function saveDb(db) {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}
let db = loadDb();

const uid = () => crypto.randomBytes(8).toString('hex');

// ---------- middleware ----------
app.use(express.json({ limit: '5mb' }));
app.use(session({
  secret: SESSION_SECRET,
  name: 'djboard.sid',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === '1',
    maxAge: 30 * 24 * 3600 * 1000,
  },
}));
app.use(requireAuth);
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

// ---------- auth routes ----------
app.post('/api/login', (req, res) => {
  if (!AUTH_ENABLED) return res.json({ ok: true });
  const { password } = req.body || {};
  if (typeof password === 'string' && checkPassword(password)) {
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: 'Login failed' });
      req.session.authed = true;
      res.json({ ok: true });
    });
    return;
  }
  res.status(401).json({ error: 'Invalid password' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/session', (req, res) => {
  res.json({ authRequired: AUTH_ENABLED, authed: !AUTH_ENABLED || !!req.session.authed });
});

// ---------- uploads ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, uid() + ext);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(png|jpe?g|gif|webp|svg\+xml|avif)$/.test(file.mimetype);
    cb(ok ? null : new Error('Only image files are allowed'), ok);
  },
});

app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ url: '/uploads/' + req.file.filename });
});

// ---------- notes ----------
app.get('/api/notes', (req, res) => res.json(db.notes));

app.post('/api/notes', (req, res) => {
  const now = new Date().toISOString();
  const note = {
    id: uid(),
    title: req.body.title || '',
    text: req.body.text || '',
    checklist: req.body.checklist || [],
    tags: req.body.tags || [],
    color: req.body.color || '',
    textColor: req.body.textColor || '',
    images: req.body.images || [],
    pinned: !!req.body.pinned,
    done: !!req.body.done,
    reminder: req.body.reminder || null,
    x: req.body.x ?? null,
    y: req.body.y ?? null,
    z: req.body.z ?? 1,
    groupId: req.body.groupId ?? null,
    createdAt: now,
    updatedAt: now,
  };
  db.notes.unshift(note);
  saveDb(db);
  res.json(note);
});

app.put('/api/notes/:id', (req, res) => {
  const note = db.notes.find((n) => n.id === req.params.id);
  if (!note) return res.status(404).json({ error: 'Not found' });
  const fields = ['title', 'text', 'checklist', 'tags', 'color', 'textColor', 'images', 'pinned', 'done', 'reminder', 'x', 'y', 'z', 'groupId'];
  const prevGroupId = note.groupId;
  for (const f of fields) if (f in req.body) note[f] = req.body[f];
  note.updatedAt = new Date().toISOString();
  saveDb(db);
  res.json(note);
  if ('groupId' in req.body && prevGroupId && prevGroupId !== note.groupId) dissolveIfTooSmall(prevGroupId);
});

app.delete('/api/notes/:id', (req, res) => {
  const note = db.notes.find((n) => n.id === req.params.id);
  if (note) {
    // clean up uploaded images belonging to this note
    for (const url of note.images || []) {
      const f = path.join(UPLOAD_DIR, path.basename(url));
      fs.rm(f, { force: true }, () => {});
    }
  }
  db.notes = db.notes.filter((n) => n.id !== req.params.id);
  saveDb(db);
  res.json({ ok: true });
  if (note?.groupId) dissolveIfTooSmall(note.groupId);
});

// ---------- note groups (stacked card decks on the board) ----------
// a group is just a board position; membership lives on each note's groupId.
// groups auto-dissolve once they'd have fewer than 2 members left.
function dissolveIfTooSmall(groupId) {
  const remaining = db.notes.filter((n) => n.groupId === groupId).length;
  if (remaining >= 2) return;
  for (const n of db.notes) if (n.groupId === groupId) n.groupId = null;
  const had = db.groups.some((g) => g.id === groupId);
  db.groups = db.groups.filter((g) => g.id !== groupId);
  if (had) saveDb(db);
}

app.get('/api/groups', (req, res) => res.json(db.groups));

app.post('/api/groups', (req, res) => {
  const noteIds = Array.isArray(req.body.noteIds) ? req.body.noteIds : [];
  if (noteIds.length < 2) return res.status(400).json({ error: 'A group needs at least 2 notes' });
  const group = {
    id: uid(),
    name: req.body.name || `Group ${db.groups.length + 1}`,
    x: req.body.x ?? 20,
    y: req.body.y ?? 20,
    z: req.body.z ?? 1,
  };
  db.groups.push(group);
  const vacatedGroupIds = new Set();
  for (const n of db.notes) {
    if (!noteIds.includes(n.id)) continue;
    if (n.groupId && n.groupId !== group.id) vacatedGroupIds.add(n.groupId);
    n.groupId = group.id;
  }
  saveDb(db);
  res.json(group);
  // a note pulled out of its old group (e.g. multi-selected into a brand new one)
  // may have left that group too small to still make sense
  for (const gid of vacatedGroupIds) dissolveIfTooSmall(gid);
});

app.put('/api/groups/:id', (req, res) => {
  const group = db.groups.find((g) => g.id === req.params.id);
  if (!group) return res.status(404).json({ error: 'Not found' });
  for (const f of ['x', 'y', 'z', 'name']) if (f in req.body) group[f] = req.body[f];
  saveDb(db);
  res.json(group);
});

// dissolve a group — member notes are kept, just unlinked, never deleted
app.delete('/api/groups/:id', (req, res) => {
  for (const n of db.notes) if (n.groupId === req.params.id) n.groupId = null;
  db.groups = db.groups.filter((g) => g.id !== req.params.id);
  saveDb(db);
  res.json({ ok: true });
});

// ---------- tags ----------
app.get('/api/tags', (req, res) => res.json(db.tags));

app.post('/api/tags', (req, res) => {
  const name = String(req.body.name || '').trim().replace(/^#/, '').toUpperCase();
  if (!name) return res.status(400).json({ error: 'Name required' });
  if (db.tags.some((t) => t.name === name)) return res.status(409).json({ error: 'Tag exists' });
  const tag = { id: uid(), name, color: req.body.color || '#4ade80', pinned: !!req.body.pinned };
  db.tags.push(tag);
  saveDb(db);
  res.json(tag);
});

app.put('/api/tags/:id', (req, res) => {
  const tag = db.tags.find((t) => t.id === req.params.id);
  if (!tag) return res.status(404).json({ error: 'Not found' });
  if ('name' in req.body) tag.name = String(req.body.name).trim().replace(/^#/, '').toUpperCase();
  if ('color' in req.body) tag.color = req.body.color;
  if ('pinned' in req.body) tag.pinned = !!req.body.pinned;
  saveDb(db);
  res.json(tag);
});

app.delete('/api/tags/:id', (req, res) => {
  db.tags = db.tags.filter((t) => t.id !== req.params.id);
  for (const n of db.notes) n.tags = n.tags.filter((id) => id !== req.params.id);
  saveDb(db);
  res.json({ ok: true });
});

// ---------- widgets ----------
app.get('/api/widgets', (req, res) => res.json(db.widgets));

app.post('/api/widgets', (req, res) => {
  const widget = {
    id: uid(),
    type: req.body.type || 'clock',
    x: req.body.x ?? 20,
    y: req.body.y ?? 20,
    w: req.body.w ?? 260,
    h: req.body.h ?? 160,
    z: req.body.z ?? 1,
    config: req.body.config || {},
  };
  db.widgets.push(widget);
  saveDb(db);
  res.json(widget);
});

app.put('/api/widgets/:id', (req, res) => {
  const widget = db.widgets.find((w) => w.id === req.params.id);
  if (!widget) return res.status(404).json({ error: 'Not found' });
  const fields = ['x', 'y', 'w', 'h', 'z', 'config'];
  for (const f of fields) if (f in req.body) widget[f] = req.body[f];
  saveDb(db);
  res.json(widget);
});

app.delete('/api/widgets/:id', (req, res) => {
  db.widgets = db.widgets.filter((w) => w.id !== req.params.id);
  saveDb(db);
  res.json({ ok: true });
});

// ---------- standalone reminders ----------
app.get('/api/reminders', (req, res) => res.json(db.reminders));

app.post('/api/reminders', (req, res) => {
  if (!req.body.text || !req.body.at) return res.status(400).json({ error: 'text and at required' });
  const rem = {
    id: uid(),
    text: String(req.body.text),
    at: req.body.at,
    freq: req.body.freq || 'once',
    enabled: true,
  };
  db.reminders.push(rem);
  saveDb(db);
  res.json(rem);
});

app.put('/api/reminders/:id', (req, res) => {
  const rem = db.reminders.find((r) => r.id === req.params.id);
  if (!rem) return res.status(404).json({ error: 'Not found' });
  for (const f of ['text', 'at', 'freq', 'enabled']) if (f in req.body) rem[f] = req.body[f];
  saveDb(db);
  res.json(rem);
});

app.delete('/api/reminders/:id', (req, res) => {
  db.reminders = db.reminders.filter((r) => r.id !== req.params.id);
  saveDb(db);
  res.json({ ok: true });
});

// ---------- reminder scheduler ----------
function advanceReminder(r) {
  const step = { hourly: 3600e3, daily: 86400e3, weekly: 604800e3 }[r.freq];
  if (!step) {
    r.enabled = false;
    return;
  }
  let t = new Date(r.at).getTime();
  const now = Date.now();
  while (t <= now) t += step;
  r.at = new Date(t).toISOString();
}

async function checkReminders() {
  const now = Date.now();
  let changed = false;
  for (const n of db.notes) {
    const r = n.reminder;
    if (r && r.enabled && new Date(r.at).getTime() <= now) {
      advanceReminder(r);
      changed = true;
    }
  }
  for (const rem of db.reminders) {
    if (rem.enabled && new Date(rem.at).getTime() <= now) {
      advanceReminder(rem);
      changed = true;
    }
  }
  // hydration widgets: reset the daily cup count at the start of each new day
  const nowD = new Date();
  const today = nowD.toDateString();
  for (const wdg of db.widgets) {
    if (wdg.type !== 'water') continue;
    const c = wdg.config || (wdg.config = {});
    if (c.date !== today) { c.date = today; c.cups = 0; c.lastDrink = null; c.lastReminded = null; changed = true; }
  }
  if (changed) saveDb(db);
}
setInterval(() => checkReminders().catch((e) => console.error('Reminder check error:', e.message)), 30 * 1000);

app.listen(PORT, () => console.log(`DJBoard running at http://localhost:${PORT}`));
