import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerminalRecovery } from '../public/recovery.js';

function fixture() {
  let now = 0, nextId = 0;
  const timers = new Map(), states = [], connections = [];
  const recovery = createTerminalRecovery({
    onState: (state) => states.push(state),
    retryDelays: [5, 10, 20], stableMs: 50, timeoutMs: 100,
    schedule(fn, delay) { const id = ++nextId; timers.set(id, { at: now + delay, fn }); return id; },
    cancel(id) { timers.delete(id); },
    createConnection(callbacks) {
      const connection = { ...callbacks, disposed: 0, input: [], resized: 0,
        dispose() { this.disposed++; return Promise.resolve(); },
        send(data) { this.input.push(data); },
        resize() { this.resized++; },
      };
      connections.push(connection);
      return connection;
    },
  });
  const advance = (ms) => {
    const end = now + ms;
    while (true) {
      const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      timers.delete(next[0]); now = next[1].at; next[1].fn();
    }
    now = end;
  };
  return { recovery, connections, states, timers, advance };
}

test('a dropped viewer reconnects automatically and forwards input to the replacement', () => {
  const f = fixture();
  f.recovery.start();
  f.connections[0].onOpen();
  f.connections[0].onClose();
  assert.equal(f.states.at(-1), 'reconnecting');
  assert.equal(f.connections[0].disposed, 1);
  f.advance(4);
  assert.equal(f.connections.length, 1);
  f.advance(1);
  f.connections[1].onOpen();
  assert.equal(f.states.at(-1), 'connected');
  f.recovery.send('hello');
  f.recovery.resize();
  assert.deepEqual(f.connections[1].input, ['hello']);
  assert.equal(f.connections[1].resized, 1);
});

test('brief successful handshakes cannot cause an endless reconnect loop for a missing pane', () => {
  const f = fixture();
  f.recovery.start();
  for (const delay of [5, 10, 20]) {
    f.connections.at(-1).onOpen();
    f.connections.at(-1).onClose();
    f.advance(delay);
  }
  f.connections.at(-1).onOpen();
  f.connections.at(-1).onClose();
  assert.equal(f.states.at(-1), 'failed');
  assert.equal(f.connections.length, 4);
  f.advance(1000);
  assert.equal(f.connections.length, 4);
  assert.equal(f.recovery.retry(), true);
  assert.equal(f.connections.length, 5);
  assert.equal(f.states.at(-1), 'connecting');
});

test('a stable recovery resets the backoff for the next independent interruption', () => {
  const f = fixture();
  f.recovery.start();
  f.connections[0].onClose(); f.advance(5);
  f.connections[1].onClose(); f.advance(10);
  f.connections[2].onOpen(); f.advance(50);
  f.connections[2].onClose(); f.advance(5);
  assert.equal(f.connections.length, 4, 'new interruption uses the shortest delay again');
});

test('returning to the board cancels pending retries and ignores old socket callbacks', async () => {
  const f = fixture();
  f.recovery.start();
  const old = f.connections[0];
  old.onClose();
  await f.recovery.dispose();
  const stateCount = f.states.length;
  old.onOpen(); old.onClose();
  f.advance(1000);
  assert.equal(f.states.length, stateCount);
  assert.equal(f.connections.length, 1);
  assert.equal(f.timers.size, 0);
  assert.equal(f.recovery.retry(), false);
});

test('returning while connected waits for detach and cannot be undone by late reconnects', async () => {
  const f = fixture();
  f.recovery.start();
  f.connections[0].onOpen();
  let release, done = false;
  f.connections[0].dispose = () => new Promise((resolve) => { release = resolve; });
  const detached = f.recovery.dispose().then(() => { done = true; });
  await Promise.resolve();
  assert.equal(done, false);
  f.connections[0].onClose();
  f.advance(1000);
  assert.equal(f.connections.length, 1);
  release(); await detached;
  assert.equal(done, true);
});

test('a stalled opening times out and retries instead of remaining stuck on Connecting', () => {
  const f = fixture();
  f.recovery.start();
  f.advance(100);
  assert.equal(f.states.at(-1), 'reconnecting');
  assert.equal(f.connections[0].disposed, 1);
  f.advance(5);
  assert.equal(f.connections.length, 2);
  f.connections[0].onOpen();
  assert.equal(f.states.at(-1), 'reconnecting', 'stale onOpen cannot mark the replacement connected');
});

test('repeated start or retry requests do not create competing viewers', () => {
  const f = fixture();
  f.recovery.start(); f.recovery.start(); f.recovery.retry();
  assert.equal(f.connections.length, 1);
  f.connections[0].onOpen();
  f.recovery.retry();
  assert.equal(f.connections.length, 1);
});
