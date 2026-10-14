import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { connectTerminal } from '../public/connection.js';
import { createTerminalRecovery } from '../public/recovery.js';
import { returnToBoard } from '../public/board-return.js';
import { createThemeSync, readFontSize } from '../public/theme-sync.js';

// Run the actual entry module against a small DOM/socket adapter. This checks
// UI wiring and lifecycle without requiring a user's browser or live agent.
const entry = fs.readFileSync(new URL('../public/popout.js', import.meta.url), 'utf8')
  .replace(/^import .+;\n/gm, '');
function fixture() {
  let now = 0, nextId = 0, closed = false;
  const timers = new Map(), sockets = [], events = new Map(), elements = new Map(), terminals = [];
  const preferences = new Map([['cm-term-fontsize', '13']]);
  const storage = { getItem: (key) => preferences.get(key) ?? null };
  let themeHook;
  const schedule = (fn, delay) => { const id = ++nextId; timers.set(id, { at: now + delay, fn }); return id; };
  const cancel = (id) => timers.delete(id);
  const advance = (ms) => {
    const end = now + ms;
    while (true) {
      const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      timers.delete(next[0]); now = next[1].at; next[1].fn();
    }
    now = end;
  };
  const get = (id) => {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, { dataset: {}, hidden: false, disabled: false, textContent: '', title: '',
        classList: { toggle(name, present) { if (present) classes.add(name); else classes.delete(name); }, contains: (name) => classes.has(name) } });
    }
    return elements.get(id);
  };
  class Terminal {
    cols = 80; rows = 24;
    constructor(options) { this.options = options; terminals.push(this); }
    loadAddon() {} open() {} reset() {} focus() {} write() {} dispose() {}
    onData() { return { dispose() {} }; }
    attachCustomKeyEventHandler() {}
  }
  class Fit { fit() {} }
  class Socket {
    readyState = 0;
    constructor() { sockets.push(this); }
    send() {}
    close() { this.readyState = 3; this.onclose?.(); }
  }
  class Observer { observe() {} disconnect() {} }
  const location = { href: 'http://localhost:7878/ext/session-popout/popout.html?sessionId=s-1',
    protocol: 'http:', search: '?sessionId=s-1', reload() {} };
  const board = { closed: false, location: { origin: 'http://localhost:7878', hash: '' }, focus() {} };
  const window = { location, opener: board, localStorage: storage,
    requestAnimationFrame: (fn) => schedule(fn, 0), cancelAnimationFrame: cancel,
    addEventListener: (type, fn) => events.set(type, fn),
    removeEventListener: (type) => events.delete(type),
    close() { closed = true; events.get('pagehide')?.(); },
  };
  const scope = { connectTerminal, returnToBoard, createThemeSync, readFontSize,
    normalizeFontSize: (raw) => Number(raw) || 12,
    readTerminalTheme: () => ({ background: '#abc', foreground: '#123' }),
    onThemeChange: (fn) => { themeHook = fn; }, initStyles: () => themeHook?.(),
    selectStyle: () => themeHook?.(), setCustomStyles() {},
    createTerminalRecovery: (opts) => createTerminalRecovery({ ...opts, schedule, cancel, retryDelays: [1, 2], stableMs: 50, timeoutMs: 100 }),
    URLSearchParams, location, window, Terminal, FitAddon: { FitAddon: Fit }, WebSocket: Socket, ResizeObserver: Observer,
    globalThis: { Terminal, FitAddon: { FitAddon: Fit } },
    document: { getElementById: get, fonts: { ready: Promise.resolve() } },
  };
  new Function(...Object.keys(scope), entry)(...Object.values(scope));
  return { get, sockets, events, advance, timers, board, terminals, preferences, storage, closed: () => closed };
}

test('Retry stays hidden during a disconnect and successful automatic recovery', () => {
  const f = fixture();
  assert.equal(f.get('retry').hidden, true);
  assert.equal(f.get('status').dataset.state, 'connecting');
  f.sockets[0].readyState = 1; f.sockets[0].onopen();
  assert.equal(f.get('status-text').classList.contains('sr-only'), true);
  f.sockets[0].close();
  assert.equal(f.get('status-text').textContent, 'Reconnecting…');
  assert.equal(f.get('retry').hidden, true);
  f.advance(1);
  f.sockets[1].readyState = 1; f.sockets[1].onopen();
  assert.equal(f.get('status').dataset.state, 'connected');
  assert.equal(f.get('retry').hidden, true);
  f.events.get('pagehide')();
});

test('Retry appears only after recovery is exhausted and starts a fresh cycle', () => {
  const f = fixture();
  f.sockets[0].close(); f.advance(1);
  f.sockets[1].close(); f.advance(2);
  f.sockets[2].close();
  assert.equal(f.get('retry').hidden, false);
  assert.equal(f.get('status-text').textContent, 'Disconnected');
  f.get('retry').onclick();
  assert.equal(f.get('retry').hidden, true);
  assert.equal(f.get('status').dataset.state, 'connecting');
  assert.equal(f.sockets.length, 4);
  f.events.get('pagehide')();
});

test('the return icon keeps the same board handoff and cancels recovery', async () => {
  const f = fixture();
  f.sockets[0].readyState = 1; f.sockets[0].onopen();
  await f.get('board').onclick();
  assert.equal(f.sockets[0].readyState, 3);
  assert.equal(f.board.location.hash, '#session=s-1');
  assert.equal(f.closed(), true);
  f.advance(1000);
  assert.equal(f.sockets.length, 1);
  assert.equal(f.timers.size, 0);
});

test('pop-out startup and live font changes use Wrangler settings without changing recovery behavior', () => {
  const f = fixture();
  assert.equal(f.terminals[0].options.fontSize, 13);
  assert.deepEqual(f.terminals[0].options.theme, { background: '#abc', foreground: '#123' });
  assert.equal(f.terminals[0].options.allowTransparency, true);
  f.preferences.set('cm-term-fontsize', '15');
  f.events.get('storage')({ key: 'cm-term-fontsize', storageArea: f.storage });
  assert.equal(f.terminals[0].options.fontSize, 15);
  assert.equal(f.get('retry').hidden, true);
  f.events.get('pagehide')();
  assert.equal(f.events.has('storage'), false);
});
