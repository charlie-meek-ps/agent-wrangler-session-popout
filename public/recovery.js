// Retry a lost viewer connection with a bounded backoff. A socket handshake
// isn't proof that a tmux pane exists: only a stable connection resets attempts.
export function createTerminalRecovery({ createConnection, onState,
  schedule = setTimeout, cancel = clearTimeout,
  retryDelays = [1000, 2000, 4000, 8000, 15000], stableMs = 10000, timeoutMs = 10000 }) {
  let current = null;
  let disposed = false;
  let generation = 0;
  let attempts = 0;
  let phase = 'idle';
  let retryTimer, stableTimer, timeoutTimer;
  let detached = Promise.resolve();
  const report = (state) => { phase = state; onState(state); };

  const clearTimers = () => {
    for (const timer of [retryTimer, stableTimer, timeoutTimer]) cancel(timer);
    retryTimer = stableTimer = timeoutTimer = undefined;
  };
  const fail = (id) => {
    if (disposed || id !== generation) return;
    generation++;
    clearTimers();
    detached = Promise.resolve(current?.dispose());
    current = null;
    if (attempts >= retryDelays.length) {
      report('failed');
      return;
    }
    const delay = retryDelays[attempts++];
    report('reconnecting');
    retryTimer = schedule(open, delay);
  };
  const open = () => {
    if (disposed) return;
    clearTimers();
    const id = ++generation;
    report(attempts ? 'reconnecting' : 'connecting');
    try {
      current = createConnection({
        onOpen() {
          if (disposed || id !== generation) return;
          cancel(timeoutTimer);
          timeoutTimer = undefined;
          report('connected');
          stableTimer = schedule(() => { attempts = 0; }, stableMs);
        },
        onClose() { fail(id); },
      });
      timeoutTimer = schedule(() => fail(id), timeoutMs);
    } catch { fail(id); }
  };

  return {
    start() { if (phase === 'idle') open(); },
    retry() {
      if (disposed) return false;
      if (phase !== 'failed') return true;
      attempts = 0;
      open();
      return true;
    },
    send: (data) => current?.send(data),
    resize: () => current?.resize(),
    dispose() {
      if (disposed) return detached;
      disposed = true;
      generation++;
      clearTimers();
      if (current) detached = Promise.resolve(current.dispose());
      current = null;
      return detached;
    },
  };
}
