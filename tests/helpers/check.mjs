import assert from 'node:assert/strict';

// Bridges the checklist style the suites are written in onto node:test subtests.
// Each check reports on its own and a failing one does not stop the rest, which
// matters when a suite walks a whole feature end to end.
//
// t.test() returns a promise. Left unawaited, node cancels the subtests as soon
// as the parent resolves, so they are collected here and awaited via settled().
export function checks(t) {
  const pending = [];
  const check = (name, condition, detail = '') => {
    pending.push(t.test(name, () => {
      assert.ok(condition, detail ? `${name} :: ${detail}` : name);
    }));
  };
  check.settled = () => Promise.all(pending);
  return check;
}
