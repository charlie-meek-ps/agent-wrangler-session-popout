// Wrangler's existing /pty protocol. It is an internal endpoint, so changes to
// the host protocol must be checked when updating supported Wrangler versions.
export function terminalUrl(location, sessionId, cols, rows) {
  const url = new URL('/pty', location.href);
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  url.search = new URLSearchParams({ sessionId, cols: String(cols), rows: String(rows) });
  return url.href;
}

export function connectTerminal({ location, sessionId, terminal, fit, WebSocket,
  onStatus = () => {}, onOpen = () => {}, onClose = () => {} }) {
  let disposed = false;
  let resolveDetached;
  let detachTimer;
  const detached = new Promise((resolve) => { resolveDetached = resolve; });
  fit.fit();
  const socket = new WebSocket(terminalUrl(location, sessionId, terminal.cols, terminal.rows));
  socket.binaryType = 'arraybuffer';
  onStatus('Connecting…');

  const resize = () => {
    if (disposed) return;
    fit.fit();
    if (socket.readyState === 1) {
      socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
    }
  };
  socket.onopen = () => {
    if (disposed) return;
    onStatus('Connected');
    onOpen();
    resize();
    terminal.focus();
  };
  socket.onmessage = ({ data }) => {
    if (!disposed) terminal.write(typeof data === 'string' ? data : new Uint8Array(data));
  };
  socket.onerror = () => {
    if (!disposed) onStatus('Connection interrupted.');
  };
  socket.onclose = () => {
    clearTimeout(detachTimer);
    resolveDetached();
    if (!disposed) {
      onStatus('Disconnected');
      onClose();
    }
  };
  const send = (data) => {
    if (!disposed && socket.readyState === 1) socket.send(data);
  };
  const input = terminal.onData(send);

  return {
    resize,
    send,
    dispose() {
      if (disposed) return detached;
      disposed = true;
      input.dispose();
      // Closing this viewer detaches its tmux client; it doesn't stop the agent.
      if (socket.readyState === 3) {
        resolveDetached();
        return detached;
      }
      // A lost connection must not leave Return to board waiting forever.
      detachTimer = setTimeout(resolveDetached, 2000);
      socket.close();
      return detached;
    },
  };
}
