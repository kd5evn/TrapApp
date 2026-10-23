// Trap Squad Tracker: rules module.
// Pure logic, no DOM. Every function that changes state mutates the state it is
// given and returns { ok: true, ... } or { ok: false, reason }. The screen
// (app.js) snapshots before each change so any change can be undone.

export const POSTS = 5;
export const SQUADS = 4;
export const SQUAD_NAMES = ['Shooting', 'On Deck', 'In The Hole', 'In The Deep Hole'];
export const GAMES = ['Trap', 'Continental', 'Doubles'];
export const DEFAULT_TARGETS = { Trap: 25, Continental: 25, Doubles: 50 };
export const DEFAULT_REFILL = 400;
export const COMPLETE_UNDO_MS = 60 * 1000;
export const STATE_VERSION = 1;

const ok = (extra = {}) => ({ ok: true, ...extra });
const fail = reason => ({ ok: false, reason });

export function uid(prefix = 'id') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function newSquad(startedAt = null) {
  return { id: uid('q'), posts: Array(POSTS).fill(null), startedAt };
}

export function newField(index) {
  return {
    id: `trap${index + 1}`,
    name: `Trap ${index + 1}`,
    game: 'Trap',
    clays: null, // clays loaded in the thrower; null = not tracked yet
    refill: DEFAULT_REFILL, // amount the Reset dialog starts with
    low: false, // latched red state, cleared only by Reset
    squads: Array.from({ length: SQUADS }, () => newSquad()),
  };
}

export function createState() {
  return {
    version: STATE_VERSION,
    shooters: [],
    fields: [newField(0), newField(1)],
    targets: { ...DEFAULT_TARGETS },
    allowance: 0, // optional percent added for re-thrown targets
    history: [],
  };
}

// Make sure a state loaded from storage has every part the screen expects.
export function normalize(input) {
  const base = createState();
  if (!input || typeof input !== 'object') return base;
  const s = base;
  s.targets = { ...DEFAULT_TARGETS, ...(input.targets || {}) };
  for (const g of GAMES) {
    const n = Number(s.targets[g]);
    s.targets[g] = Number.isFinite(n) && n > 0 ? Math.round(n) : DEFAULT_TARGETS[g];
  }
  const al = Number(input.allowance);
  s.allowance = Number.isFinite(al) && al >= 0 && al <= 100 ? al : 0;
  s.shooters = Array.isArray(input.shooters)
    ? input.shooters
        .filter(x => x && typeof x.id === 'string' && typeof x.name === 'string' && x.name.trim())
        .map(x => ({ id: x.id, name: x.name.trim(), archived: !!x.archived }))
    : [];
  const known = new Set(s.shooters.map(x => x.id));
  s.history = Array.isArray(input.history) ? input.history.filter(h => h && typeof h === 'object') : [];
  s.fields = base.fields.map((def, fi) => {
    const src = (input.fields && input.fields[fi]) || {};
    const f = { ...def };
    f.game = GAMES.includes(src.game) ? src.game : 'Trap';
    f.clays = Number.isFinite(src.clays) && src.clays >= 0 ? Math.round(src.clays) : null;
    f.refill = Number.isFinite(src.refill) && src.refill > 0 ? Math.round(src.refill) : DEFAULT_REFILL;
    f.low = !!src.low;
    const srcSquads = Array.isArray(src.squads) ? src.squads : [];
    f.squads = Array.from({ length: SQUADS }, (_, si) => {
      const q = srcSquads[si] || {};
      const posts = Array.from({ length: POSTS }, (_, pi) => {
        const id = Array.isArray(q.posts) ? q.posts[pi] : null;
        return typeof id === 'string' && known.has(id) ? id : null;
      });
      // A shooter can only be in a squad once.
      const seen = new Set();
      posts.forEach((id, pi) => {
        if (id && seen.has(id)) posts[pi] = null;
        if (id) seen.add(id);
      });
      return { id: typeof q.id === 'string' ? q.id : uid('q'), posts, startedAt: q.startedAt || null };
    });
    return f;
  });
  return s;
}

// ---------- lookups ----------

export const squadCount = squad => squad.posts.filter(Boolean).length;
export const getShooter = (state, id) => state.shooters.find(x => x.id === id) || null;
export const nameOf = (state, id) => (getShooter(state, id) || {}).name || '';

function squadAt(state, fi, si) {
  const f = state.fields[fi];
  return f ? f.squads[si] || null : null;
}

export function activeShooters(state) {
  return state.shooters
    .filter(x => !x.archived)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

// ---------- squads ----------

export function place(state, shooterId, fi, si, pi) {
  const sh = getShooter(state, shooterId);
  if (!sh || sh.archived) return fail('no-shooter');
  const sq = squadAt(state, fi, si);
  if (!sq) return fail('bad-squad');
  if (!Number.isInteger(pi) || pi < 0 || pi >= POSTS) return fail('bad-post');
  if (sq.posts[pi] !== null) return fail('post-full');
  if (sq.posts.includes(shooterId)) return fail('already-in-squad');
  sq.posts[pi] = shooterId;
  return ok();
}

export function remove(state, fi, si, pi) {
  const sq = squadAt(state, fi, si);
  if (!sq || !Number.isInteger(pi) || pi < 0 || pi >= POSTS) return fail('bad-post');
  if (sq.posts[pi] === null) return fail('post-empty');
  sq.posts[pi] = null;
  return ok();
}

// from / to are { fi, si, pi }
export function move(state, from, to) {
  const src = squadAt(state, from.fi, from.si);
  const dst = squadAt(state, to.fi, to.si);
  if (!src || !dst) return fail('bad-squad');
  if (!Number.isInteger(from.pi) || from.pi < 0 || from.pi >= POSTS) return fail('bad-post');
  if (!Number.isInteger(to.pi) || to.pi < 0 || to.pi >= POSTS) return fail('bad-post');
  const id = src.posts[from.pi];
  if (!id) return fail('post-empty');
  if (src === dst && from.pi === to.pi) return fail('same-post');
  if (dst.posts[to.pi] !== null) return fail('post-full');
  if (src !== dst && dst.posts.includes(id)) return fail('already-in-squad');
  src.posts[from.pi] = null;
  dst.posts[to.pi] = id;
  return ok();
}

// Move a whole squad up or down a field's queue (positions 0 to 3).
export function reorderSquad(state, fi, from, to) {
  const f = state.fields[fi];
  if (!f) return fail('bad-field');
  if (![from, to].every(n => Number.isInteger(n) && n >= 0 && n < SQUADS)) return fail('bad-squad');
  if (from === to) return fail('same-position');
  const [sq] = f.squads.splice(from, 1);
  f.squads.splice(to, 0, sq);
  return ok();
}

// ---------- games and clays ----------

export function setGame(state, fi, game) {
  const f = state.fields[fi];
  if (!f) return fail('bad-field');
  if (!GAMES.includes(game)) return fail('bad-game');
  f.game = game;
  return ok();
}

export function setTarget(state, game, n) {
  if (!GAMES.includes(game)) return fail('bad-game');
  n = Math.round(Number(n));
  if (!Number.isFinite(n) || n < 1 || n > 500) return fail('bad-number');
  state.targets[game] = n;
  return ok();
}

export function setAllowance(state, pct) {
  pct = Number(pct);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return fail('bad-number');
  state.allowance = pct;
  return ok();
}

export function targetsFor(state, game, shooters) {
  const per = state.targets[game] || 0;
  // Round first so floating-point noise (55.00000000000001) never adds a clay.
  return Math.ceil(Math.round(shooters * per * (1 + (state.allowance || 0) / 100) * 1e6) / 1e6);
}

// Clays the next squad (the first squad with anyone in it) needs for a full round.
export function neededClays(state, fi) {
  const f = state.fields[fi];
  if (!f) return 0;
  for (const sq of f.squads) {
    const n = squadCount(sq);
    if (n > 0) return targetsFor(state, f.game, n);
  }
  return 0;
}

// Red when the count is lower than the next squad needs, or when the red state
// was latched by Complete. Only Reset clears the latch.
export function isLow(state, fi) {
  const f = state.fields[fi];
  if (!f || typeof f.clays !== 'number') return false;
  return f.low || f.clays < neededClays(state, fi);
}

export function setClays(state, fi, value) {
  const f = state.fields[fi];
  if (!f) return fail('bad-field');
  if (value === null || value === '') {
    f.clays = null;
    return ok();
  }
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 0 || n > 100000) return fail('bad-number');
  f.clays = n;
  return ok();
}

export function resetClays(state, fi, amount) {
  const f = state.fields[fi];
  if (!f) return fail('bad-field');
  const n = Math.round(Number(amount));
  if (!Number.isFinite(n) || n < 1 || n > 100000) return fail('bad-number');
  f.clays = n;
  f.refill = n;
  f.low = false;
  return ok({ clays: n });
}

export function setRefill(state, fi, value) {
  const f = state.fields[fi];
  if (!f) return fail('bad-field');
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 1 || n > 100000) return fail('bad-number');
  f.refill = n;
  return ok();
}

// ---------- complete ----------

export function complete(state, fi, now = Date.now()) {
  const f = state.fields[fi];
  if (!f) return fail('bad-field');
  const sq = f.squads[0];
  const n = squadCount(sq);
  if (n === 0) return fail('empty-squad');
  const targets = targetsFor(state, f.game, n);
  state.history.push({
    id: uid('h'),
    fieldId: f.id,
    fieldName: f.name,
    game: f.game,
    posts: sq.posts.map(id => (id ? nameOf(state, id) : '')),
    shooters: n,
    targets,
    startedAt: sq.startedAt || null,
    endedAt: now,
  });
  if (typeof f.clays === 'number') f.clays = Math.max(0, f.clays - targets);
  f.squads.shift();
  f.squads.push(newSquad());
  f.squads[0].startedAt = now;
  if (typeof f.clays === 'number' && f.clays < neededClays(state, fi)) f.low = true;
  return ok({ targets, shooters: n });
}

// ---------- roster ----------

const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
const tidy = name => String(name || '').replace(/\s+/g, ' ').trim();

export function addShooter(state, name) {
  name = tidy(name);
  if (!name) return fail('empty');
  if (name.length > 40) return fail('too-long');
  const dup = state.shooters.find(x => sameName(x.name, name));
  if (dup && !dup.archived) return fail('duplicate');
  if (dup) {
    dup.archived = false;
    dup.name = name;
    return ok({ shooter: dup, reactivated: true });
  }
  const shooter = { id: uid('s'), name, archived: false };
  state.shooters.push(shooter);
  return ok({ shooter });
}

export function renameShooter(state, id, name) {
  const sh = getShooter(state, id);
  if (!sh) return fail('no-shooter');
  name = tidy(name);
  if (!name) return fail('empty');
  if (name.length > 40) return fail('too-long');
  if (state.shooters.some(x => x.id !== id && !x.archived && sameName(x.name, name))) return fail('duplicate');
  sh.name = name;
  return ok();
}

// Archived shooters leave the list and every squad; past history keeps their name.
export function archiveShooter(state, id) {
  const sh = getShooter(state, id);
  if (!sh) return fail('no-shooter');
  sh.archived = true;
  for (const f of state.fields) {
    for (const sq of f.squads) sq.posts = sq.posts.map(p => (p === id ? null : p));
  }
  return ok();
}

// Clear Roster: the shooter list, every squad's posts and the day's history.
export function clearRoster(state) {
  state.shooters = [];
  state.history = [];
  for (const f of state.fields) {
    for (const sq of f.squads) sq.posts = Array(POSTS).fill(null);
  }
  return ok();
}

// ---------- history ----------

const pad = n => String(n).padStart(2, '0');
export const dayKey = ts => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
export const timeKey = ts => {
  if (!ts) return '';
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function historyFor(state, day) {
  const all = state.history.slice().sort((a, b) => a.endedAt - b.endedAt);
  return day ? all.filter(h => dayKey(h.endedAt) === day) : all;
}

export function totals(entries) {
  const out = { squads: entries.length, shooters: 0, targets: 0, byField: {} };
  for (const h of entries) {
    out.shooters += h.shooters;
    out.targets += h.targets;
    const b = (out.byField[h.fieldName] ||= { squads: 0, targets: 0 });
    b.squads += 1;
    b.targets += h.targets;
  }
  return out;
}

const csvCell = v => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(entries) {
  const head = ['Date', 'Start time', 'End time', 'Field', 'Game', 'Shooters', 'Post 1', 'Post 2', 'Post 3', 'Post 4', 'Post 5', 'Estimated clays'];
  const rows = entries.map(h => [
    dayKey(h.endedAt),
    timeKey(h.startedAt),
    timeKey(h.endedAt),
    h.fieldName,
    h.game,
    h.shooters,
    ...Array.from({ length: POSTS }, (_, i) => (h.posts && h.posts[i]) || ''),
    h.targets,
  ]);
  return [head, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

// ---------- undo ----------

export class UndoStack {
  constructor(limit = 50) {
    this.items = [];
    this.limit = limit;
  }
  get size() {
    return this.items.length;
  }
  push(kind, snapshot, now = Date.now()) {
    this.items.push({ kind, snapshot, at: now });
    if (this.items.length > this.limit) this.items.shift();
  }
  // Complete can only be undone for 60 seconds.
  pop(now = Date.now()) {
    const top = this.items[this.items.length - 1];
    if (!top) return fail('nothing-to-undo');
    if (top.kind === 'complete' && now - top.at > COMPLETE_UNDO_MS) return fail('complete-expired');
    this.items.pop();
    return ok({ snapshot: top.snapshot, kind: top.kind });
  }
  clear() {
    this.items = [];
  }
}
