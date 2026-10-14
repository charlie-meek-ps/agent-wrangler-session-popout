import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import manifest from '../index.js';
import client, { createPopouts } from '../public/index.js';
import { connectTerminal, terminalUrl } from '../public/connection.js';
import { returnToBoard } from '../public/board-return.js';

test('package declaration agrees with the installable manifest', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url)));
  for (const [key, value] of Object.entries(pkg.wranglerExtension)) {
    assert.deepEqual(manifest[key], value, key);
  }
  assert.ok(fs.existsSync(new URL(`../${manifest.client}`, import.meta.url)));
});

test('one live window per session, closed windows reopen, different sessions stay separate', () => {
  const calls = [];
  const popouts = createPopouts({ open(...args) {
    const popup = { closed: false, focusCount: 0, focus() { this.focusCount++; } };
    calls.push({ args, popup });
    return popup;
  } });
  const session = { sessionId: 's-1', label: 'Review & fix #1' };
  const first = popouts.open(session);
  assert.equal(popouts.open(session), first);
  assert.equal(calls.length, 1);
  assert.equal(first.focusCount, 2);
  const url = new URL(calls[0].args[0]);
  assert.equal(url.searchParams.get('title'), session.label);
  assert.equal(url.searchParams.get('sessionId'), session.sessionId);
  assert.notEqual(popouts.open({ sessionId: 's-2' }), first);
  first.closed = true;
  assert.notEqual(popouts.open(session), first);
  assert.equal(calls.length, 3);
});

test('blocked pop-outs can be retried', () => {
  let blocked = true;
  const popup = { focus() {} };
  const popouts = createPopouts({ open: () => blocked ? null : popup });
  assert.equal(popouts.open({ sessionId: 's-1' }), null);
  blocked = false;
  assert.equal(popouts.open({ sessionId: 's-1' }), popup);
});

test('successful pop-out releases the selected embedded session, including when reusing its window', () => {
  const browser = { location: { hash: '#session=s-1' }, open: () => ({ focus() {} }) };
  const popouts = createPopouts(browser, { selectedSessionId: () => 's-1' });
  const popup = popouts.open({ sessionId: 's-1' });
  assert.equal(browser.location.hash, '', 'clear selection so graph ticks cannot reattach the main terminal');
  browser.location.hash = '#session=s-1';
  assert.equal(popouts.open({ sessionId: 's-1' }), popup);
  assert.equal(browser.location.hash, '', 'release the board again if the same session was reopened');
});

test('blocked pop-out keeps the embedded terminal and fullscreen session selected', () => {
  const browser = { location: { hash: '#session=s-1' }, open: () => null };
  const popouts = createPopouts(browser, { selectedSessionId: () => 's-1' });
  assert.equal(popouts.open({ sessionId: 's-1' }), null);
  assert.equal(browser.location.hash, '#session=s-1');
});

test('popping out a different session preserves the current board selection', () => {
  const browser = { location: { hash: '#session=s-2' }, open: () => ({ focus() {} }) };
  const popouts = createPopouts(browser, { selectedSessionId: () => 's-2' });
  popouts.open({ sessionId: 's-1' });
  assert.equal(browser.location.hash, '#session=s-2');
});

test('menu action is offered only for sessions with a live terminal', () => {
  let contribution;
  client.register({ api: { keys: { bind() {} } }, register(slot, value) {
    if (slot === 'card.action') contribution = value;
  } });
  assert.deepEqual(contribution.items({ managed: false }), []);
  assert.equal(contribution.items({ managed: true })[0].label, 'Pop out terminal');
});

function shortcutHarness({ blocked = false } = {}) {
  const contributions = new Map();
  const opened = [], notifications = [];
  let binding, selectedId = null;
  const browser = { location: { hash: '' }, open(...args) {
    opened.push(args);
    return blocked ? null : { closed: false, focus() {} };
  } };
  const original = globalThis.window;
  globalThis.window = browser;
  const api = {
    keys: { bind(value) { binding = value; } },
    selectedSessionId: () => selectedId,
    ui: { notify: (value) => notifications.push(value) },
  };
  try { client.register({ api, register: (slot, value) => contributions.set(slot, value) }); }
  finally { globalThis.window = original; }
  return { binding, browser, opened, notifications, contributions,
    select(session) {
      selectedId = session?.sessionId || null;
      browser.location.hash = selectedId ? `#session=${selectedId}` : '';
      contributions.get('panel.section').update({}, session);
    },
    clearSelection() { selectedId = null; },
  };
}

test('shortcut pops out the selected live session, using the same handoff as the menu', () => {
  const h = shortcutHarness();
  assert.deepEqual({ combo: h.binding.combo, scope: h.binding.scope }, manifest.keybindings[0]);
  assert.equal(h.binding.when({}), false);
  h.select({ sessionId: 's-1', label: 'Live work', managed: true });
  assert.equal(h.binding.when({}), true);
  assert.equal(h.binding.when({ repeat: true }), false);
  h.binding.run();
  assert.equal(new URL(h.opened[0][0]).searchParams.get('sessionId'), 's-1');
  assert.equal(h.browser.location.hash, '');
  assert.deepEqual(h.notifications, []);
});

test('shortcut becomes inactive when a session stops, selection clears, or the extension unmounts', () => {
  const h = shortcutHarness();
  h.select({ sessionId: 's-1', managed: true });
  h.clearSelection();
  assert.equal(h.binding.when({}), false);
  h.select({ sessionId: 's-1', managed: false });
  assert.equal(h.binding.when({}), false);
  h.select({ sessionId: 's-1', managed: true });
  h.contributions.get('panel.section').unmount();
  assert.equal(h.binding.when({}), false);
  assert.equal(h.opened.length, 0);
});

test('a blocked shortcut shows guidance and leaves the session on the board', () => {
  const h = shortcutHarness({ blocked: true });
  h.select({ sessionId: 's-1', managed: true });
  h.binding.run();
  assert.equal(h.browser.location.hash, '#session=s-1');
  assert.equal(h.notifications[0].id, 'popup-blocked');
});

test('terminal URL preserves origin and safely encodes the session id', () => {
  const url = new URL(terminalUrl({ href: 'https://localhost:7999/ext/session-popout/popout.html', protocol: 'https:' },
    'session?x=1&z=2', 90, 30));
  assert.equal(url.protocol, 'wss:');
  assert.equal(url.host, 'localhost:7999');
  assert.equal(url.pathname, '/pty');
  assert.equal(url.searchParams.get('sessionId'), 'session?x=1&z=2');
  assert.equal(url.searchParams.get('cols'), '90');
  assert.equal(url.searchParams.get('rows'), '30');
});

function fixture() {
  let socket, input, disposed = 0, focused = 0;
  const writes = [], statuses = [], sent = [];
  const terminal = {
    cols: 80, rows: 24,
    focus() { focused++; },
    write(data) { writes.push(data); },
    onData(fn) { input = fn; return { dispose() { disposed++; } }; },
  };
  class Socket {
    constructor(url) { this.url = url; this.readyState = 0; socket = this; }
    send(data) { sent.push(data); }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  const connection = connectTerminal({
    location: { href: 'http://localhost:7999/', protocol: 'http:' },
    sessionId: 's-1', terminal, fit: { fit() {} }, WebSocket: Socket,
    onStatus: (value) => statuses.push(value),
  });
  return { connection, socket, terminal, input: (data) => input(data), writes, statuses, sent,
    disposed: () => disposed, focused: () => focused };
}

test('terminal connection forwards input, text/binary output, and actual resized dimensions', () => {
  const f = fixture();
  f.input('ignored before open');
  assert.equal(f.sent.length, 0);
  f.socket.readyState = 1;
  f.socket.onopen();
  assert.equal(f.focused(), 1);
  assert.deepEqual(JSON.parse(f.sent[0]), { type: 'resize', cols: 80, rows: 24 });
  f.input('hello\r');
  assert.equal(f.sent[1], 'hello\r');
  f.socket.onmessage({ data: 'agent output' });
  f.socket.onmessage({ data: new Uint8Array([65, 66]).buffer });
  assert.deepEqual(f.writes, ['agent output', new Uint8Array([65, 66])]);
  f.terminal.cols = 120;
  f.terminal.rows = 40;
  f.connection.resize();
  assert.deepEqual(JSON.parse(f.sent.at(-1)), { type: 'resize', cols: 120, rows: 40 });
});

test('closing a viewer disposes input once and prevents stale callbacks from writing or sending', () => {
  const f = fixture();
  f.socket.readyState = 1;
  f.socket.onopen();
  const sentBefore = f.sent.length;
  const statusBefore = f.statuses.length;
  f.connection.dispose();
  f.connection.dispose();
  f.socket.onopen();
  f.socket.onmessage({ data: 'late output' });
  f.input('late input');
  f.connection.resize();
  assert.equal(f.disposed(), 1);
  assert.equal(f.socket.readyState, 3);
  assert.equal(f.sent.length, sentBefore);
  assert.equal(f.statuses.length, statusBefore);
  assert.deepEqual(f.writes, []);
});

test('low-level disconnect reports its state to the recovery layer', () => {
  const f = fixture();
  f.socket.onclose();
  assert.match(f.statuses.at(-1), /Disconnected/);
});

test('disposing waits for the old socket to close before a replacement viewer can attach', async () => {
  const f = fixture();
  f.socket.close = () => { f.socket.readyState = 2; };
  let detached = false;
  const done = f.connection.dispose().then(() => { detached = true; });
  await Promise.resolve();
  assert.equal(detached, false);
  f.socket.readyState = 3;
  f.socket.onclose();
  await done;
  assert.equal(detached, true);
});

test('Return to board waits for detachment, selects the same session, then closes the pop-out', async () => {
  const log = [];
  let release;
  const boardLocation = { origin: 'http://localhost:7878',
    set hash(value) { log.push(`select:${value}`); } };
  const browser = {
    location: { href: 'http://localhost:7878/ext/session-popout/popout.html' },
    opener: { closed: false, location: boardLocation, focus: () => log.push('focus') },
    close: () => log.push('close'),
  };
  const returning = returnToBoard({ browser, sessionId: 's-1', detach: () => {
    log.push('detach');
    return new Promise((resolve) => { release = resolve; });
  } });
  assert.deepEqual(log, ['focus', 'detach']);
  release();
  assert.equal(await returning, true);
  assert.deepEqual(log, ['focus', 'detach', 'select:#session=s-1', 'close']);
});

test('Return to board opens the exact session in a new board when the opener has closed', async () => {
  let opened, destination, detached = false, closed = false;
  const browser = {
    location: { href: 'http://localhost:7878/ext/session-popout/popout.html' },
    opener: { closed: true },
    open(url) {
      opened = url;
      return { focus() {}, location: { set href(value) {
        assert.equal(detached, true, 'old terminal must detach before board navigation');
        destination = value;
      } } };
    },
    close() { closed = true; },
  };
  assert.equal(await returnToBoard({ browser, sessionId: 'session?x=1&z=2', detach: () => { detached = true; } }), true);
  assert.equal(opened, 'about:blank');
  assert.equal(destination, 'http://localhost:7878/#session=session%3Fx%3D1%26z%3D2');
  assert.equal(closed, true);
});

test('blocked board window preserves the connected pop-out', async () => {
  let detached = false, closed = false;
  const browser = {
    location: { href: 'http://localhost:7878/ext/session-popout/popout.html' },
    opener: null, open: () => null, close() { closed = true; },
  };
  assert.equal(await returnToBoard({ browser, sessionId: 's-1', detach: () => { detached = true; } }), false);
  assert.equal(detached, false);
  assert.equal(closed, false);
});

test('Return to board leaves an opener that navigated to another site alone', async () => {
  let destination;
  const browser = {
    location: { href: 'http://localhost:7878/ext/session-popout/popout.html' },
    opener: { closed: false, location: { origin: 'https://example.com', hash: '#original' } },
    open: () => ({ focus() {}, location: { set href(value) { destination = value; } } }),
    close() {},
  };
  await returnToBoard({ browser, sessionId: 's-1', detach() {} });
  assert.equal(browser.opener.location.hash, '#original');
  assert.equal(destination, 'http://localhost:7878/#session=s-1');
});
