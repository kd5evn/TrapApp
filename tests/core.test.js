import test from 'node:test';
import assert from 'node:assert/strict';
import * as c from '../core.js';

const withShooters = (...names) => {
  const s = c.createState();
  const ids = names.map(n => c.addShooter(s, n).shooter.id);
  return [s, ids];
};

test('a new state has two fields with four empty squads of five posts', () => {
  const s = c.createState();
  assert.equal(s.fields.length, 2);
  for (const f of s.fields) {
    assert.equal(f.squads.length, 4);
    for (const q of f.squads) assert.deepEqual(q.posts, [null, null, null, null, null]);
  }
});

test('place fills an open post and rejects a full post', () => {
  const [s, [a, b]] = withShooters('Ann', 'Bob');
  assert.ok(c.place(s, a, 0, 0, 0).ok);
  assert.equal(c.place(s, b, 0, 0, 0).reason, 'post-full');
  assert.ok(c.place(s, b, 0, 0, 1).ok);
  assert.equal(c.squadCount(s.fields[0].squads[0]), 2);
});

test('the same shooter cannot be in one squad twice', () => {
  const [s, [a]] = withShooters('Ann');
  assert.ok(c.place(s, a, 0, 1, 0).ok);
  assert.equal(c.place(s, a, 0, 1, 3).reason, 'already-in-squad');
});

test('a shooter can be in several squads, on both fields', () => {
  const [s, [a]] = withShooters('Ann');
  assert.ok(c.place(s, a, 0, 0, 0).ok);
  assert.ok(c.place(s, a, 0, 2, 4).ok);
  assert.ok(c.place(s, a, 1, 0, 2).ok);
});

test('place rejects bad squads, posts and unknown shooters', () => {
  const [s, [a]] = withShooters('Ann');
  assert.equal(c.place(s, a, 5, 0, 0).reason, 'bad-squad');
  assert.equal(c.place(s, a, 0, 9, 0).reason, 'bad-squad');
  assert.equal(c.place(s, a, 0, 0, 5).reason, 'bad-post');
  assert.equal(c.place(s, 'nope', 0, 0, 0).reason, 'no-shooter');
});

test('remove opens the post', () => {
  const [s, [a]] = withShooters('Ann');
  c.place(s, a, 0, 0, 0);
  assert.ok(c.remove(s, 0, 0, 0).ok);
  assert.equal(c.remove(s, 0, 0, 0).reason, 'post-empty');
  assert.equal(s.fields[0].squads[0].posts[0], null);
});

test('move goes to an open post in any squad on either field', () => {
  const [s, [a, b]] = withShooters('Ann', 'Bob');
  c.place(s, a, 0, 0, 0);
  c.place(s, b, 1, 1, 0);
  assert.ok(c.move(s, { fi: 0, si: 0, pi: 0 }, { fi: 1, si: 2, pi: 3 }).ok);
  assert.equal(s.fields[0].squads[0].posts[0], null);
  assert.equal(s.fields[1].squads[2].posts[3], a);
  assert.equal(c.move(s, { fi: 1, si: 2, pi: 3 }, { fi: 1, si: 1, pi: 0 }).reason, 'post-full');
  assert.equal(c.move(s, { fi: 0, si: 0, pi: 4 }, { fi: 0, si: 0, pi: 3 }).reason, 'post-empty');
});

test('move inside the same squad is allowed; onto itself is not', () => {
  const [s, [a]] = withShooters('Ann');
  c.place(s, a, 0, 0, 0);
  assert.ok(c.move(s, { fi: 0, si: 0, pi: 0 }, { fi: 0, si: 0, pi: 4 }).ok);
  assert.equal(c.move(s, { fi: 0, si: 0, pi: 4 }, { fi: 0, si: 0, pi: 4 }).reason, 'same-post');
});

test('move is refused when the target squad already has that shooter', () => {
  const [s, [a]] = withShooters('Ann');
  c.place(s, a, 0, 0, 0);
  c.place(s, a, 0, 1, 0);
  assert.equal(c.move(s, { fi: 0, si: 0, pi: 0 }, { fi: 0, si: 1, pi: 2 }).reason, 'already-in-squad');
  assert.equal(s.fields[0].squads[0].posts[0], a);
});

test('reorderSquad moves a whole squad and keeps its shooters', () => {
  const [s, [a, b]] = withShooters('Ann', 'Bob');
  c.place(s, a, 0, 0, 0);
  c.place(s, b, 0, 3, 2);
  const first = s.fields[0].squads[0].id;
  assert.ok(c.reorderSquad(s, 0, 3, 0).ok);
  assert.equal(s.fields[0].squads[0].posts[2], b);
  assert.equal(s.fields[0].squads[1].id, first);
  assert.equal(c.reorderSquad(s, 0, 1, 1).reason, 'same-position');
  assert.equal(c.reorderSquad(s, 0, 1, 7).reason, 'bad-squad');
});

test('complete: estimate, history, queue moves up, new empty squad at the back', () => {
  const [s, ids] = withShooters('A', 'B', 'C', 'D', 'E');
  ids.slice(0, 3).forEach((id, i) => c.place(s, id, 0, 0, i));
  c.place(s, ids[3], 0, 1, 0);
  const second = s.fields[0].squads[1].id;
  const r = c.complete(s, 0, 1000);
  assert.ok(r.ok);
  assert.equal(r.targets, 75); // 3 shooters x 25
  assert.equal(s.fields[0].squads[0].id, second);
  assert.equal(s.fields[0].squads.length, 4);
  assert.equal(c.squadCount(s.fields[0].squads[3]), 0);
  assert.equal(s.history.length, 1);
  assert.equal(s.history[0].shooters, 3);
  assert.deepEqual(s.history[0].posts, ['A', 'B', 'C', '', '']);
  assert.equal(s.fields[0].squads[0].startedAt, 1000);
  // the other field is untouched
  assert.equal(s.history.filter(h => h.fieldId === 'trap2').length, 0);
});

test('complete uses the field game: Doubles is 50 per shooter', () => {
  const [s, ids] = withShooters('A', 'B');
  c.setGame(s, 1, 'Doubles');
  ids.forEach((id, i) => c.place(s, id, 1, 0, i));
  assert.equal(c.complete(s, 1).targets, 100);
});

test('complete is refused for an empty shooting squad', () => {
  const s = c.createState();
  assert.equal(c.complete(s, 0).reason, 'empty-squad');
  assert.equal(s.history.length, 0);
});

test('complete subtracts from the clay count and never goes below zero', () => {
  const [s, ids] = withShooters('A', 'B');
  c.setClays(s, 0, 100);
  ids.forEach((id, i) => c.place(s, id, 0, 0, i));
  c.complete(s, 0);
  assert.equal(s.fields[0].clays, 50);
  c.place(s, ids[0], 0, 0, 0);
  c.place(s, ids[1], 0, 0, 1);
  c.place(s, ids[0], 0, 1, 0);
  c.complete(s, 0);
  c.complete(s, 0);
  assert.equal(s.fields[0].clays, 0);
});

test('an untracked clay count is never subtracted and never red', () => {
  const [s, [a]] = withShooters('A');
  c.place(s, a, 0, 0, 0);
  assert.equal(s.fields[0].clays, null);
  assert.equal(c.isLow(s, 0), false);
  c.complete(s, 0);
  assert.equal(s.fields[0].clays, null);
});

test('red when the next squad cannot finish its round; stays red until Reset', () => {
  const [s, ids] = withShooters('A', 'B', 'C', 'D', 'E');
  c.setClays(s, 0, 140);
  ids.slice(0, 2).forEach((id, i) => c.place(s, id, 0, 0, i)); // needs 50
  ids.forEach((id, i) => c.place(s, id, 0, 1, i)); // next squad needs 125
  assert.equal(c.isLow(s, 0), false);
  c.complete(s, 0); // 140 - 50 = 90, next squad needs 125
  assert.equal(s.fields[0].clays, 90);
  assert.equal(s.fields[0].low, true);
  assert.equal(c.isLow(s, 0), true);
  // typing a bigger number does not clear it; only Reset does
  c.setClays(s, 0, 1000);
  assert.equal(c.isLow(s, 0), true);
  c.resetClays(s, 0, 400);
  assert.equal(s.fields[0].clays, 400);
  assert.equal(s.fields[0].refill, 400);
  assert.equal(c.isLow(s, 0), false);
});

test('red shows while a squad is too big for the count, and clears when it is fixed', () => {
  const [s, ids] = withShooters('A', 'B', 'C', 'D', 'E');
  c.setClays(s, 0, 100);
  ids.slice(0, 4).forEach((id, i) => c.place(s, id, 0, 0, i)); // needs 100
  assert.equal(c.isLow(s, 0), false);
  c.place(s, ids[4], 0, 0, 4); // needs 125
  assert.equal(c.isLow(s, 0), true);
  c.remove(s, 0, 0, 4);
  assert.equal(c.isLow(s, 0), false);
});

test('the other field is not affected by one field going red', () => {
  const [s, ids] = withShooters('A', 'B');
  c.setClays(s, 0, 10);
  c.place(s, ids[0], 0, 0, 0);
  assert.equal(c.isLow(s, 0), true);
  assert.equal(c.isLow(s, 1), false);
});

test('allowance adds a percent for re-thrown targets', () => {
  const [s, [a, b]] = withShooters('A', 'B');
  c.setAllowance(s, 10);
  c.place(s, a, 0, 0, 0);
  c.place(s, b, 0, 0, 1);
  assert.equal(c.complete(s, 0).targets, 55); // 50 + 10%
});

test('roster: add, duplicates, rename, archive', () => {
  const s = c.createState();
  assert.equal(c.addShooter(s, '   ').reason, 'empty');
  const a = c.addShooter(s, '  Ann   Lee ').shooter;
  assert.equal(a.name, 'Ann Lee');
  assert.equal(c.addShooter(s, 'ann lee').reason, 'duplicate');
  const b = c.addShooter(s, 'Bob').shooter;
  assert.equal(c.renameShooter(s, b.id, 'ANN LEE').reason, 'duplicate');
  assert.ok(c.renameShooter(s, b.id, 'Bobby').ok);
  c.place(s, a.id, 0, 0, 0);
  assert.ok(c.archiveShooter(s, a.id).ok);
  assert.equal(s.fields[0].squads[0].posts[0], null);
  assert.deepEqual(c.activeShooters(s).map(x => x.name), ['Bobby']);
  const again = c.addShooter(s, 'Ann Lee'); // archived name comes back
  assert.ok(again.reactivated);
  assert.deepEqual(c.activeShooters(s).map(x => x.name), ['Ann Lee', 'Bobby']);
});

test('the shooter list is alphabetical regardless of case', () => {
  const [s] = withShooters('charlie', 'Alice', 'bob');
  assert.deepEqual(c.activeShooters(s).map(x => x.name), ['Alice', 'bob', 'charlie']);
});

test('Clear Roster removes shooters, placements and history, but keeps clays and games', () => {
  const [s, [a]] = withShooters('Ann');
  c.setClays(s, 0, 300);
  c.setGame(s, 0, 'Doubles');
  c.place(s, a, 0, 0, 0);
  c.complete(s, 0);
  c.place(s, a, 0, 1, 0);
  c.clearRoster(s);
  assert.equal(s.shooters.length, 0);
  assert.equal(s.history.length, 0);
  assert.ok(s.fields.every(f => f.squads.every(q => c.squadCount(q) === 0)));
  assert.equal(s.fields[0].game, 'Doubles');
  assert.equal(s.fields[0].clays, 250); // 300 minus one Doubles shooter (50)
});

test('history grouping, totals and CSV', () => {
  const [s, [a, b]] = withShooters('Ann', 'Bob, Jr.');
  c.place(s, a, 0, 0, 0);
  c.place(s, b, 0, 0, 1);
  c.complete(s, 0, new Date(2026, 9, 21, 10, 30).getTime());
  c.place(s, a, 1, 0, 0);
  c.complete(s, 1, new Date(2026, 9, 22, 9, 5).getTime());
  assert.equal(c.historyFor(s, '2026-10-21').length, 1);
  assert.equal(c.historyFor(s).length, 2);
  const t = c.totals(c.historyFor(s));
  assert.equal(t.targets, 75);
  assert.equal(t.byField['Trap 1'].targets, 50);
  const csv = c.toCsv(c.historyFor(s, '2026-10-21'));
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^Date,Start time,End time,Field,Game,Shooters,Post 1/);
  assert.match(lines[1], /^2026-10-21,[0-9:]*,10:30,Trap 1,Trap,2,Ann,"Bob, Jr\.",,,,50$/);
});

test('undo stack: pop returns the snapshot; Complete expires after 60 seconds', () => {
  const u = new c.UndoStack();
  assert.equal(u.pop().reason, 'nothing-to-undo');
  u.push('place', 'S1', 0);
  u.push('complete', 'S2', 1000);
  assert.equal(u.pop(1000 + 61000).reason, 'complete-expired');
  assert.equal(u.size, 2);
  const r = u.pop(1000 + 59000);
  assert.equal(r.snapshot, 'S2');
  assert.equal(u.pop(10 ** 9).snapshot, 'S1'); // ordinary changes never expire
});

test('undo stack keeps only the most recent entries', () => {
  const u = new c.UndoStack(3);
  for (let i = 0; i < 5; i++) u.push('place', 'S' + i, 0);
  assert.equal(u.size, 3);
  assert.equal(u.pop(0).snapshot, 'S4');
});

test('normalize repairs loaded data', () => {
  const messy = {
    shooters: [{ id: 'x', name: ' Zed ' }, { id: 7, name: 'bad' }],
    fields: [{ game: 'Nope', clays: -5, squads: [{ posts: ['x', 'x', 'ghost'] }] }],
    targets: { Trap: 'abc', Doubles: 40 },
  };
  const s = c.normalize(messy);
  assert.equal(s.shooters.length, 1);
  assert.equal(s.shooters[0].name, 'Zed');
  assert.equal(s.fields.length, 2);
  assert.equal(s.fields[0].game, 'Trap');
  assert.equal(s.fields[0].clays, null);
  assert.deepEqual(s.fields[0].squads[0].posts, ['x', null, null, null, null]);
  assert.equal(s.fields[0].squads.length, 4);
  assert.equal(s.targets.Trap, 25);
  assert.equal(s.targets.Doubles, 40);
  assert.equal(c.normalize(null).fields.length, 2);
});

test('setRefill sets the full-machine count without touching clays', () => {
  const s = c.createState();
  c.setClays(s, 0, 120);
  assert.equal(c.setRefill(s, 0, 300).ok, true);
  assert.equal(s.fields[0].refill, 300);
  assert.equal(s.fields[0].clays, 120);
  assert.equal(c.setRefill(s, 0, 0).ok, false);
});
