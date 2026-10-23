import * as core from './core.js';
import { POSTS, SQUADS, SQUAD_NAMES, GAMES } from './core.js';

const KEY = 'trapapp.state.v1';
const $ = sel => document.querySelector(sel);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- state and storage ----------

let storageOk = true;
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return core.normalize(JSON.parse(raw));
  } catch (e) { storageOk = false; }
  return core.createState();
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); storageOk = true; } catch (e) { storageOk = false; }
}

let state = load();
const undo = new core.UndoStack();
let selected = null; // shooter id chosen by tap
let query = '';
let suppressClick = false;

// Run a change: snapshot first, undo it again if the rules refuse it.
function act(kind, fn) {
  const snap = JSON.stringify(state);
  const res = fn(state);
  if (res && res.ok === false) return res;
  undo.push(kind, snap);
  save();
  render();
  return res || { ok: true };
}

const REASONS = {
  'post-full': 'That post is already taken.',
  'already-in-squad': 'That shooter is already in this squad.',
  'no-shooter': 'Shooter not found.',
  'empty-squad': 'The shooting squad is empty.',
  duplicate: 'That name is already on the list.',
  empty: 'Please type a name.',
  'too-long': 'Names can be up to 40 characters.',
  'bad-number': 'Please enter a valid number.',
};
const why = r => REASONS[r] || 'That move is not allowed.';

// ---------- toast ----------

let toastTimer = null;
function toast(msg, withUndo = false, ms = 4500) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${withUndo ? '<button data-act="undo">Undo</button>' : ''}`;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// ---------- render ----------

function placements(id) {
  let n = 0;
  for (const f of state.fields) for (const sq of f.squads) if (sq.posts.includes(id)) n++;
  return n;
}

function todayEntries() { return core.historyFor(state, core.dayKey(Date.now())); }

function renderTop() {
  const tot = core.totals(todayEntries());
  const sel = selected && core.getShooter(state, selected);
  const status = sel
    ? `<div class="status hint" data-act="deselect">Tap an open post for ${esc(sel.name)} (tap here to cancel)</div>`
    : `<div class="status">Today: ${tot.squads} squad${tot.squads === 1 ? '' : 's'}, about ${tot.targets} clays</div>`;
  $('#topbar').innerHTML = `
    <h1>Trap Squad Tracker</h1>${status}
    <button data-act="undo" ${undo.size ? '' : 'disabled'}>Undo</button>
    <button data-act="history">History</button>
    <button data-act="settings">Settings</button>`;
  const warn = !storageOk ? 'Warning: this browser is not saving changes. Export your data before closing.' : '';
  let bar = $('#warn');
  if (warn) {
    if (!bar) { bar = document.createElement('div'); bar.id = 'warn'; bar.className = 'warn'; $('#topbar').after(bar); }
    bar.textContent = warn;
  } else if (bar) bar.remove();
}

function renderField(fi) {
  const f = state.fields[fi];
  const low = core.isLow(state, fi);
  const need = core.neededClays(state, fi);
  const mine = todayEntries().filter(h => h.fieldId === f.id);
  const t = core.totals(mine);
  const squads = f.squads.map((sq, si) => {
    const n = core.squadCount(sq);
    const posts = sq.posts.map((id, pi) => {
      const attrs = `data-f="${fi}" data-s="${si}" data-p="${pi}"`;
      const body = id
        ? `<div class="slot full" ${attrs} data-name="${esc(core.nameOf(state, id))}">${esc(core.nameOf(state, id))}</div>`
        : `<div class="slot open ${selected ? 'armed' : ''}" ${attrs}>${selected ? 'tap to place' : 'open'}</div>`;
      return `<div class="post"><div class="plabel">Post ${pi + 1}</div>${body}</div>`;
    }).join('');
    return `<div class="squad ${si === 0 ? 'shooting' : ''}" data-f="${fi}" data-s="${si}">
      <div class="shead">
        <div class="grip" data-f="${fi}" data-s="${si}" aria-label="Drag to reorder squad">&#8801;</div>
        <div class="sname">${SQUAD_NAMES[si]} <span class="sub">${n}/${POSTS}</span></div>
        ${si > 0 ? `<button class="mini" data-act="up" data-f="${fi}" data-s="${si}" aria-label="Move squad up">&#9650;</button>` : ''}
        ${si < SQUADS - 1 ? `<button class="mini" data-act="down" data-f="${fi}" data-s="${si}" aria-label="Move squad down">&#9660;</button>` : ''}
        ${si === 0 ? `<button class="complete" data-act="complete" data-f="${fi}" ${n ? '' : 'disabled'}>Complete</button>` : ''}
      </div>
      <div class="posts">${posts}</div>
    </div>`;
  }).join('');
  const el = $(`#field-${fi}`);
  el.className = `field ${low ? 'low' : ''}`;
  el.innerHTML = `
    <div class="fhead">
      <h2>${esc(f.name)}</h2>
      <select data-act="game" data-f="${fi}" aria-label="Game for ${esc(f.name)}">
        ${GAMES.map(g => `<option ${g === f.game ? 'selected' : ''}>${g}</option>`).join('')}
      </select>
      <span class="today">${t.squads} squad${t.squads === 1 ? '' : 's'}, ${t.targets} clays today</span>
    </div>
    <div class="squads">${squads}</div>
    <div class="claybar">
      <label for="clays-${fi}">Clays</label>
      <input id="clays-${fi}" type="number" inputmode="numeric" min="0" placeholder="not set" value="${f.clays ?? ''}" data-act="clays" data-f="${fi}">
      <button data-act="reset" data-f="${fi}">Reset</button>
      <span class="lowtag">LOW: refill</span>
      <span class="need">${need ? `Next squad needs ${need}` : ''}</span>
    </div>`;
}

function renderList() {
  const q = query.trim().toLowerCase();
  const people = core.activeShooters(state).filter(s => !q || s.name.toLowerCase().includes(q));
  const list = $('#list');
  if (!people.length) {
    list.innerHTML = `<div class="empty">${state.shooters.some(s => !s.archived) ? 'No names match.' : 'No shooters yet. Tap Add Shooter.'}</div>`;
    return;
  }
  list.innerHTML = people.map(s => {
    const n = placements(s.id);
    return `<div class="chip ${s.id === selected ? 'sel' : ''}" data-id="${s.id}" data-name="${esc(s.name)}">
      <span class="nm">${esc(s.name)}</span>${n ? `<span class="badge">in ${n}</span>` : ''}</div>`;
  }).join('');
}

function render() {
  renderTop();
  renderField(0);
  renderField(1);
  renderList();
}

// ---------- dialogs ----------

const dlg = $('#dlg');
function openDialog(html, { wide = false, onOpen } = {}) {
  dlg.className = wide ? 'wide' : '';
  dlg.innerHTML = `<div class="dbox">${html}</div>`;
  if (!dlg.open) dlg.showModal();
  if (onOpen) onOpen(dlg);
}
function closeDialog() { if (dlg.open) dlg.close(); }
dlg.addEventListener('click', e => { if (e.target === dlg) closeDialog(); });

function addShooterDialog() {
  openDialog(`<h3>Add Shooter</h3>
    <input type="text" id="nm" placeholder="Name" autocomplete="off" autocapitalize="words" maxlength="40">
    <div class="err" id="err"></div>
    <div class="btns"><button data-d="cancel">Cancel</button><button class="primary" data-d="ok">Add</button></div>`, {
    onOpen: d => {
      const input = d.querySelector('#nm');
      const submit = () => {
        const res = act('add', s => core.addShooter(s, input.value));
        if (!res.ok) { d.querySelector('#err').textContent = why(res.reason); return; }
        closeDialog();
        query = ''; $('#search').value = '';
        selected = res.shooter.id;
        render();
        const chip = document.querySelector(`.chip[data-id="${selected}"]`);
        if (chip) { chip.scrollIntoView({ block: 'center' }); chip.classList.add('flash'); }
      };
      d.querySelector('[data-d=ok]').onclick = submit;
      d.querySelector('[data-d=cancel]').onclick = closeDialog;
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
      setTimeout(() => input.focus(), 50);
    },
  });
}

function shooterMenu(id) {
  const sh = core.getShooter(state, id);
  if (!sh) return;
  openDialog(`<h3>${esc(sh.name)}</h3>
    <input type="text" id="nm" value="${esc(sh.name)}" maxlength="40" autocapitalize="words" aria-label="Name">
    <div class="err" id="err"></div>
    <div class="btns">
      <button data-d="cancel">Cancel</button>
      <button class="danger" data-d="archive">Archive</button>
      <button class="primary" data-d="save">Rename</button>
    </div>
    <p class="sub">Archive removes this name from the list and from any squads. Past history keeps it.</p>`, {
    onOpen: d => {
      d.querySelector('[data-d=cancel]').onclick = closeDialog;
      d.querySelector('[data-d=save]').onclick = () => {
        const res = act('rename', s => core.renameShooter(s, id, d.querySelector('#nm').value));
        if (!res.ok) d.querySelector('#err').textContent = why(res.reason); else closeDialog();
      };
      d.querySelector('[data-d=archive]').onclick = () => {
        if (selected === id) selected = null;
        act('archive', s => core.archiveShooter(s, id));
        closeDialog();
      };
    },
  });
}

function removeDialog(fi, si, pi) {
  const name = core.nameOf(state, state.fields[fi].squads[si].posts[pi]);
  openDialog(`<h3>${esc(name)}</h3>
    <p>${esc(state.fields[fi].name)}, ${SQUAD_NAMES[si]}, Post ${pi + 1}</p>
    <div class="btns"><button data-d="cancel">Keep</button><button class="danger" data-d="rm">Remove from squad</button></div>`, {
    onOpen: d => {
      d.querySelector('[data-d=cancel]').onclick = closeDialog;
      d.querySelector('[data-d=rm]').onclick = () => { act('remove', s => core.remove(s, fi, si, pi)); closeDialog(); };
    },
  });
}

function clearHistoryDialog() {
  const n = state.history.length;
  if (!n) { toast('History is already empty.'); return; }
  openDialog(`<h3>Clear history?</h3>
    <p>This erases all ${n} completed squad${n === 1 ? '' : 's'} from every day, including today's totals. Shooters, squads and clay counts stay. Export a CSV first if you want a copy. You can undo it right after.</p>
    <div class="btns"><button data-d="cancel">Cancel</button><button class="danger" data-d="ok">Clear history</button></div>`, {
    onOpen: d => {
      d.querySelector('[data-d=cancel]').onclick = historyDialog;
      d.querySelector('[data-d=ok]').onclick = () => {
        act('clear-history', s => core.clearHistory(s));
        closeDialog();
        toast('History cleared.', true, 8000);
      };
    },
  });
}

function clearRosterDialog() {
  openDialog(`<h3>Clear Roster?</h3>
    <p>This removes every shooter, empties all squads and erases the history. Clay counts and games stay. You can undo it right after.</p>
    <div class="btns"><button data-d="cancel">Cancel</button><button class="danger" data-d="ok">Clear Roster</button></div>`, {
    onOpen: d => {
      d.querySelector('[data-d=cancel]').onclick = closeDialog;
      d.querySelector('[data-d=ok]').onclick = () => {
        selected = null;
        act('clear', s => core.clearRoster(s));
        closeDialog();
        toast('Roster cleared.', true, 8000);
      };
    },
  });
}

function settingsDialog() {
  openDialog(`<h3>Settings</h3>
    <p>Clays used per shooter for each game:</p>
    ${GAMES.map(g => `<div class="row"><label for="t-${g}">${g}</label><input type="number" inputmode="numeric" id="t-${g}" value="${state.targets[g]}" min="1"></div>`).join('')}
    <p>Clays in a full machine (what Reset sets):</p>
    ${state.fields.map((f, i) => `<div class="row"><label for="r-${i}">${esc(f.name)}</label><input type="number" inputmode="numeric" id="r-${i}" value="${f.refill}" min="1"></div>`).join('')}
    <div class="row"><label for="al">Extra clays for re-throws (%)</label><input type="number" inputmode="decimal" id="al" value="${state.allowance}" min="0" max="100"></div>
    <div class="err" id="err"></div>
    <div class="btns"><button data-d="cancel">Cancel</button><button class="primary" data-d="ok">Save</button></div>`, {
    onOpen: d => {
      d.querySelector('[data-d=cancel]').onclick = closeDialog;
      d.querySelector('[data-d=ok]').onclick = () => {
        const res = act('settings', s => {
          for (const g of GAMES) { const r = core.setTarget(s, g, d.querySelector(`#t-${g}`).value); if (!r.ok) return r; }
          for (let i = 0; i < s.fields.length; i++) { const r = core.setRefill(s, i, d.querySelector(`#r-${i}`).value); if (!r.ok) return r; }
          return core.setAllowance(s, d.querySelector('#al').value);
        });
        if (!res.ok) d.querySelector('#err').textContent = why(res.reason); else closeDialog();
      };
    },
  });
}

function historyDialog() {
  const days = [...new Set(core.historyFor(state).map(h => core.dayKey(h.endedAt)))].sort().reverse();
  const today = core.dayKey(Date.now());
  const draw = day => {
    const rows = core.historyFor(state, day);
    const t = core.totals(rows);
    const fields = Object.entries(t.byField).map(([n, b]) => `${esc(n)}: ${b.squads} squads, ${b.targets} clays`).join(' &middot; ');
    return `<div class="sum"><span>${t.squads} squad${t.squads === 1 ? "" : "s"}</span><span>${t.shooters} shooters</span><span>about ${t.targets} clays</span></div>
      <div class="sub">${fields}</div>
      <div class="tablewrap"><table><thead><tr><th>Time</th><th>Field</th><th>Game</th><th>Shooters</th><th class="num">Clays</th></tr></thead><tbody>
      ${rows.length ? rows.slice().reverse().map(h => `<tr><td>${core.timeKey(h.endedAt)}</td><td>${esc(h.fieldName)}</td><td>${esc(h.game)}</td>
        <td>${h.posts.map((n, i) => n ? `${i + 1}. ${esc(n)}` : '').filter(Boolean).join(', ')}</td><td class="num">${h.targets}</td></tr>`).join('')
        : '<tr><td colspan="5" class="sub">No completed squads.</td></tr>'}
      </tbody></table></div>`;
  };
  const first = days.includes(today) || !days.length ? today : days[0];
  openDialog(`<h3>History</h3>
    <div class="row"><label for="day">Day</label>
      <select id="day" style="width:auto">${(days.length ? days : [today]).map(d => `<option ${d === first ? 'selected' : ''}>${d}</option>`).join('')}</select></div>
    <div id="hbody">${draw(first)}</div>
    <div class="btns"><button class="danger" data-d="clear">Clear history</button><button data-d="all">Export all (CSV)</button><button data-d="day">Export this day (CSV)</button><button class="primary" data-d="close">Close</button></div>`, {
    wide: true,
    onOpen: d => {
      const sel = d.querySelector('#day');
      sel.onchange = () => { d.querySelector('#hbody').innerHTML = draw(sel.value); };
      d.querySelector('[data-d=close]').onclick = closeDialog;
      d.querySelector('[data-d=day]').onclick = () => exportCsv(core.historyFor(state, sel.value), `trap-squads-${sel.value}.csv`);
      d.querySelector('[data-d=clear]').onclick = clearHistoryDialog;
      d.querySelector('[data-d=all]').onclick = () => exportCsv(core.historyFor(state), 'trap-squads-all.csv');
    },
  });
}

async function exportCsv(rows, filename) {
  if (!rows.length) { toast('Nothing to export yet.'); return; }
  const csv = core.toCsv(rows);
  try {
    const file = new File([csv], filename, { type: 'text/csv' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
  }
  try {
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return;
  } catch (e) { /* fall through to the copy box */ }
  openDialog(`<h3>${esc(filename)}</h3><p>Select all, copy, and paste into Notes or Mail.</p>
    <textarea readonly style="width:100%;height:40vh;user-select:text">${esc(csv)}</textarea>
    <div class="btns"><button class="primary" data-d="close">Close</button></div>`, {
    onOpen: d => { d.querySelector('[data-d=close]').onclick = closeDialog; },
  });
}

// ---------- actions (taps, buttons) ----------

function doUndo() {
  const res = undo.pop();
  if (!res.ok) {
    if (res.reason === 'complete-expired') {
      undo.clear();
      toast('Complete can only be undone for 60 seconds.');
    } else toast('Nothing to undo.');
    render();
    return;
  }
  state = core.normalize(JSON.parse(res.snapshot));
  if (selected && !core.getShooter(state, selected)) selected = null;
  save();
  render();
  toast('Undone.');
}

function doComplete(fi) {
  const f = state.fields[fi];
  const wasLow = core.isLow(state, fi);
  const res = act('complete', s => core.complete(s, fi));
  if (!res.ok) { toast(why(res.reason)); return; }
  const lowNow = core.isLow(state, fi);
  let msg = `${f.name} complete: ${res.shooters} shooter${res.shooters === 1 ? '' : 's'}, about ${res.targets} clays.`;
  if (lowNow && !wasLow) msg += ' Clays are low.';
  toast(msg, true, 10000);
}

document.addEventListener('click', e => {
  if (suppressClick) return;
  const t = e.target;
  const btn = t.closest('[data-act]');
  if (btn && btn.tagName !== 'SELECT' && btn.tagName !== 'INPUT') {
    const fi = Number(btn.dataset.f), si = Number(btn.dataset.s);
    switch (btn.dataset.act) {
      case 'undo': doUndo(); break;
      case 'history': historyDialog(); break;
      case 'settings': settingsDialog(); break;
      case 'deselect': selected = null; render(); break;
      case 'add-shooter': addShooterDialog(); break;
      case 'clear-roster': clearRosterDialog(); break;
      case 'complete': doComplete(fi); break;
      case 'reset': {
        const amt = state.fields[fi].refill;
        const res = act('reset', s => core.resetClays(s, fi, amt));
        if (res.ok) toast(`${state.fields[fi].name} reset to ${amt} clays.`, true, 6000);
        break;
      }
      case 'up': act('reorder', s => core.reorderSquad(s, fi, si, si - 1)); break;
      case 'down': act('reorder', s => core.reorderSquad(s, fi, si, si + 1)); break;
    }
    return;
  }
  const chip = t.closest('.chip');
  if (chip) {
    selected = selected === chip.dataset.id ? null : chip.dataset.id;
    render();
    return;
  }
  const slot = t.closest('.slot');
  if (slot) {
    const fi = Number(slot.dataset.f), si = Number(slot.dataset.s), pi = Number(slot.dataset.p);
    if (slot.classList.contains('full')) { removeDialog(fi, si, pi); return; }
    if (selected) {
      const res = act('place', s => core.place(s, selected, fi, si, pi));
      if (!res.ok) toast(why(res.reason)); else selected = null, render();
    }
    return;
  }
});

document.addEventListener('change', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fi = Number(el.dataset.f);
  if (el.dataset.act === 'game') act('game', s => core.setGame(s, fi, el.value));
  if (el.dataset.act === 'clays') {
    const res = act('clays', s => core.setClays(s, fi, el.value));
    if (!res.ok) { toast(why(res.reason)); render(); }
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && selected && !dlg.open) { selected = null; render(); }
  if (e.key === 'Enter' && e.target.matches && e.target.matches('.claybar input')) e.target.blur();
});

$('#search').addEventListener('input', e => { query = e.target.value; renderList(); });

// ---------- drag and drop ----------

let drag = null;
const DRAG_PX = 8;
const LONG_MS = 650;

function clearMarks() {
  document.querySelectorAll('.drop-ok, .drop-bad, .drop-squad').forEach(n => n.classList.remove('drop-ok', 'drop-bad', 'drop-squad'));
}

function postUnder(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  if (el.closest('#roster')) return { type: 'roster', el: $('#roster') };
  const sq = el.closest('.squad');
  if (!sq) return null;
  let best = null, bd = Infinity;
  sq.querySelectorAll('.slot').forEach(s => {
    const r = s.getBoundingClientRect();
    const d = Math.abs(y - (r.top + r.bottom) / 2);
    if (d < bd) { bd = d; best = s; }
  });
  if (!best) return null;
  return { type: 'post', el: best, fi: Number(best.dataset.f), si: Number(best.dataset.s), pi: Number(best.dataset.p) };
}

// Check a drop on a copy of the state so the real one is untouched.
function dropCheck(src, tgt) {
  if (!tgt) return null;
  if (tgt.type === 'roster') return src.type === 'post' ? { ok: true, remove: true } : null;
  const copy = core.normalize(JSON.parse(JSON.stringify(state)));
  copy.shooters = state.shooters;
  const res = src.type === 'shooter'
    ? core.place(copy, src.id, tgt.fi, tgt.si, tgt.pi)
    : core.move(copy, { fi: src.fi, si: src.si, pi: src.pi }, { fi: tgt.fi, si: tgt.si, pi: tgt.pi });
  return res;
}

document.addEventListener('pointerdown', e => {
  if (dlg.open || (e.pointerType === 'mouse' && e.button !== 0)) return;
  const t = e.target;
  let src = null, el = null;
  const chip = t.closest('.chip'), slot = t.closest('.slot.full'), grip = t.closest('.grip');
  if (chip) { el = chip; src = { type: 'shooter', id: chip.dataset.id, label: chip.dataset.name }; }
  else if (slot) { el = slot; src = { type: 'post', fi: +slot.dataset.f, si: +slot.dataset.s, pi: +slot.dataset.p, label: slot.dataset.name }; }
  else if (grip) { el = grip; src = { type: 'squad', fi: +grip.dataset.f, si: +grip.dataset.s, label: SQUAD_NAMES[+grip.dataset.s] }; }
  else return;
  drag = { src, el, x0: e.clientX, y0: e.clientY, pid: e.pointerId, started: false, ghost: null, timer: null };
  try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  if (chip) drag.timer = setTimeout(() => {
    if (drag && !drag.started) { const id = drag.src.id; endDrag(); suppressClick = true; setTimeout(() => (suppressClick = false), 400); shooterMenu(id); }
  }, LONG_MS);
});

function startDrag(d) {
  d.started = true;
  clearTimeout(d.timer);
  d.el.style.opacity = '.4';
  if (selected && d.src.type === 'shooter') { selected = null; }
  const g = document.createElement('div');
  g.className = 'ghost';
  g.textContent = d.src.type === 'squad' ? `${d.src.label} squad` : d.src.label;
  document.body.appendChild(g);
  d.ghost = g;
  document.body.style.cursor = 'grabbing';
}

window.addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.pid) return;
  const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
  if (!drag.started) {
    if (Math.hypot(dx, dy) < DRAG_PX) return;
    startDrag(drag);
  }
  e.preventDefault();
  drag.ghost.style.transform = `translate(${e.clientX + 14}px, ${e.clientY - 40}px)`;
  clearMarks();
  const { src } = drag;
  if (src.type === 'squad') {
    const sq = squadUnder(e.clientX, e.clientY, src.fi);
    if (sq && +sq.dataset.s !== src.si) sq.classList.add('drop-squad');
    return;
  }
  const tgt = postUnder(e.clientX, e.clientY);
  const res = dropCheck(src, tgt);
  if (!tgt || !res) return;
  if (tgt.type === 'roster') tgt.el.classList.add('drop-ok');
  else tgt.el.classList.add(res.ok ? 'drop-ok' : 'drop-bad');
}, { passive: false });

function squadUnder(x, y, fi) {
  const el = document.elementFromPoint(x, y);
  const sq = el && el.closest('.squad');
  return sq && +sq.dataset.f === fi ? sq : null;
}

function endDrag() {
  if (!drag) return;
  clearTimeout(drag.timer);
  if (drag.ghost) drag.ghost.remove();
  if (drag.el) drag.el.style.opacity = '';
  document.body.style.cursor = '';
  clearMarks();
  drag = null;
}

window.addEventListener('pointerup', e => {
  if (!drag || e.pointerId !== drag.pid) return;
  const d = drag;
  if (!d.started) { endDrag(); return; } // a tap: the click handler deals with it
  suppressClick = true;
  setTimeout(() => (suppressClick = false), 0);
  const { src } = d;
  let result = null;
  if (src.type === 'squad') {
    const sq = squadUnder(e.clientX, e.clientY, src.fi);
    endDrag();
    if (sq && +sq.dataset.s !== src.si) result = act('reorder', s => core.reorderSquad(s, src.fi, src.si, +sq.dataset.s));
    else render();
  } else {
    const tgt = postUnder(e.clientX, e.clientY);
    endDrag();
    if (!tgt) { render(); return; }
    if (tgt.type === 'roster') {
      if (src.type === 'post') result = act('remove', s => core.remove(s, src.fi, src.si, src.pi));
      else render();
    } else if (src.type === 'shooter') {
      result = act('place', s => core.place(s, src.id, tgt.fi, tgt.si, tgt.pi));
    } else {
      result = act('move', s => core.move(s, { fi: src.fi, si: src.si, pi: src.pi }, { fi: tgt.fi, si: tgt.si, pi: tgt.pi }));
    }
  }
  if (result && !result.ok) { toast(why(result.reason)); render(); }
});

window.addEventListener('pointercancel', e => {
  if (drag && e.pointerId === drag.pid) { endDrag(); render(); }
});

// ---------- keep the screen awake, keep the data ----------

let wake = null;
async function keepAwake() {
  try { if ('wakeLock' in navigator && document.visibilityState === 'visible') wake = await navigator.wakeLock.request('screen'); } catch (e) { /* not available */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') keepAwake(); });
keepAwake();
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

// Re-read the clock-based parts every minute (day roll-over).
setInterval(() => { if (!drag && !dlg.open) renderTop(); }, 60000);

// iPad Safari ignores user-scalable=no for pinch, so stop it directly.
document.addEventListener('gesturestart', e => e.preventDefault());

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

render();
window.__trap = { get state() { return state; }, core }; // handy for tests
