import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/utils/model-canvas.js', import.meta.url), 'utf8');
const slice = (start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `missing canvas block: ${start}`);
  return source.slice(a, b);
};

test('undo and redo restore one history state and notify the editor', () => {
  const history = slice('  let history = [];', '  setTimeout(() => pushHistory(), 500);');
  const undo = slice('  function undo() {', '  const bindHistoryButton');
  const events = [];
  const context = vm.createContext({ window: { dispatchEvent: e => events.push(e.type) }, CustomEvent: class { constructor(type) { this.type = type; } }, render() {} });
  vm.runInContext(`let nodes = [], edges = [], moderatingEffects = [], gaussianCopulas = [], quadraticEffects = [], selectedIds = new Set(); ${history} ${undo}
    pushHistory(); nodes.push({id:'a'}); pushHistory(); nodes.push({id:'b'}); pushHistory(); moderatingEffects.push({id:'m'}); pushHistory();`, context);
  events.length = 0;
  vm.runInContext('undo()', context);
  assert.equal(vm.runInContext('nodes.length', context), 2);
  assert.equal(vm.runInContext('moderatingEffects.length', context), 0);
  assert.deepEqual(events, ['canvas-changed']);
  vm.runInContext('redo()', context);
  assert.equal(vm.runInContext('nodes.length', context), 2);
  assert.equal(vm.runInContext('moderatingEffects.length', context), 1);
  assert.deepEqual(events, ['canvas-changed', 'canvas-changed']);
});

test('rebinding the history toolbar replaces the previous listener', () => {
  const binding = slice('  const bindHistoryButton = ', "  document.getElementById('btn-delete')");
  const buttons = Object.fromEntries(['btn-undo', 'btn-redo'].map(id => [id, { listeners: new Set(), addEventListener(_event, fn) { this.listeners.add(fn); }, removeEventListener(_event, fn) { this.listeners.delete(fn); } }]));
  let oldCalls = 0, currentCalls = 0;
  const context = vm.createContext({ document: { getElementById: id => buttons[id] }, undo: () => oldCalls++, redo() {} });
  vm.runInContext(`{ ${binding} }`, context);
  context.undo = () => currentCalls++;
  vm.runInContext(`{ ${binding} }`, context);
  assert.equal(buttons['btn-undo'].listeners.size, 1);
  for (const fn of buttons['btn-undo'].listeners) fn({ preventDefault() {} });
  assert.equal(oldCalls, 0);
  assert.equal(currentCalls, 1);
});
