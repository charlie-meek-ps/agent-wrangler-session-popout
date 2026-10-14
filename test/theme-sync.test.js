import test from 'node:test';
import assert from 'node:assert/strict';
import { createThemeSync, readFontSize } from '../public/theme-sync.js';

function fixture({ fetchStyles = async () => ({ styles: [] }) } = {}) {
  const values = new Map([['cm-style', 'dark'], ['cm-term-fontsize', '13']]);
  const storage = { getItem: (key) => values.get(key) ?? null };
  const events = new Map(), frames = new Map(), selected = [], catalogues = [];
  let next = 0, hook, resized = 0, palette = { foreground: '#ddd' };
  const browser = {
    addEventListener: (name, fn) => events.set(name, fn),
    removeEventListener: (name) => events.delete(name),
    requestAnimationFrame: (fn) => { const id = ++next; frames.set(id, fn); return id; },
    cancelAnimationFrame: (id) => frames.delete(id),
  };
  const terminal = { options: {} };
  const normalizeFontSize = (raw) => [11, 12, 13, 14, 15].includes(Number(raw)) ? Number(raw) : 12;
  const api = {
    onThemeChange: (fn) => { hook = fn; },
    initStyles: () => hook?.(),
    readTerminalTheme: () => palette,
    selectStyle(id) { selected.push(id); palette = { foreground: id === 'light' ? '#111' : '#ddd' }; hook?.(); },
    setCustomStyles: (styles) => catalogues.push(styles),
  };
  const sync = createThemeSync({ browser, storage, terminal, normalizeFontSize, themeApi: api,
    fetchStyles, onResize: () => { resized++; } });
  selected.length = 0; // Tests below observe changes after the initial Dark selection.
  const fire = (key, storageArea = storage) => events.get('storage')?.({ key, storageArea });
  return { sync, terminal, values, frames, events, selected, catalogues, api, fire,
    resized: () => resized,
    frame() { const pending = [...frames.values()]; frames.clear(); pending.forEach((fn) => fn()); },
  };
}
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };

test('initial theme and font match shared settings, including safe font fallback', () => {
  const f = fixture();
  assert.deepEqual(f.terminal.options.theme, { foreground: '#ddd' });
  assert.equal(f.terminal.options.fontSize, 13);
  f.frame();
  assert.equal(f.resized(), 1);
  assert.equal(readFontSize({ getItem() { throw new Error('storage unavailable'); } }, () => 12), 12);
});

test('font changes update metrics, ignore unrelated storage, and coalesce refits', () => {
  const f = fixture(); f.frame();
  f.values.set('cm-term-fontsize', '15'); f.fire('cm-term-fontsize');
  assert.equal(f.terminal.options.fontSize, 15);
  f.values.set('cm-term-fontsize', '999'); f.fire('cm-term-fontsize');
  assert.equal(f.terminal.options.fontSize, 12);
  assert.equal(f.frames.size, 1);
  f.frame(); assert.equal(f.resized(), 2);
  f.fire('unrelated'); f.fire('cm-term-fontsize', {});
  assert.equal(f.frames.size, 0);
});

test('dark/light changes apply immediately without requiring catalogue access', () => {
  const f = fixture({ fetchStyles: () => { throw new Error('Should not fetch'); } });
  f.values.set('cm-style', 'light'); f.fire('cm-style');
  assert.deepEqual(f.selected, ['light']);
  assert.deepEqual(f.terminal.options.theme, { foreground: '#111' });
});

test('only the newest custom theme request applies after rapid changes', async () => {
  const requests = [];
  const f = fixture({ fetchStyles: () => new Promise((resolve) => requests.push(resolve)) });
  f.values.set('cm-style', 'forest'); f.fire('cm-style');
  f.values.set('cm-style', 'typewriter'); f.fire('cm-style');
  requests[1]({ styles: [{ id: 'typewriter' }] }); await tick();
  requests[0]({ styles: [{ id: 'forest' }] }); await tick();
  assert.deepEqual(f.selected, ['typewriter']);
  assert.deepEqual(f.catalogues, [[{ id: 'typewriter' }]]);
});

test('a helper fallback while removing a custom theme cannot overwrite the requested replacement', async () => {
  const f = fixture();
  f.api.setCustomStyles = () => f.values.set('cm-style', 'dark');
  f.values.set('cm-style', 'typewriter'); f.fire('cm-style'); await tick();
  assert.deepEqual(f.selected, ['typewriter']);
});

test('an app outage preserves the palette instead of reverting to a fixed colour scheme', async () => {
  const f = fixture({ fetchStyles: async () => { throw new Error('app restarting'); } });
  f.values.set('cm-style', 'typewriter'); f.fire('cm-style'); await tick();
  assert.deepEqual(f.terminal.options.theme, { foreground: '#ddd' });
  assert.deepEqual(f.selected, []);
});

test('refresh after a reconnect applies a custom theme change that happened during an outage', async () => {
  let offline = true;
  const f = fixture({ fetchStyles: async () => {
    if (offline) throw new Error('app restarting');
    return { styles: [{ id: 'typewriter' }] };
  } });
  f.values.set('cm-style', 'typewriter'); f.fire('cm-style'); await tick();
  assert.deepEqual(f.selected, []);
  offline = false;
  f.values.set('cm-term-fontsize', '11');
  await f.sync.refresh();
  assert.deepEqual(f.selected, ['typewriter']);
  assert.equal(f.terminal.options.fontSize, 11);
});

test('closing or returning cancels queued sizing work and prevents late custom theme updates', async () => {
  let finish;
  const f = fixture({ fetchStyles: () => new Promise((resolve) => { finish = resolve; }) });
  f.values.set('cm-style', 'typewriter'); f.fire('cm-style');
  f.sync.dispose(); f.sync.dispose();
  finish({ styles: [{ id: 'typewriter' }] }); await tick();
  assert.equal(f.events.has('storage'), false);
  assert.equal(f.frames.size, 0);
  assert.deepEqual(f.catalogues, []);
  assert.deepEqual(f.selected, []);
});
