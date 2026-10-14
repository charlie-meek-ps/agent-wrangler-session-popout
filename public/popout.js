import { connectTerminal } from './connection.js';
import { returnToBoard } from './board-return.js';
import { createTerminalRecovery } from './recovery.js';
import { createThemeSync, readFontSize } from './theme-sync.js';
import { selectStyle, setCustomStyles, readTerminalTheme, onThemeChange } from '/theme.js';
import { normalizeFontSize } from '/term-font.js';

const params = new URLSearchParams(location.search);
const sessionId = params.get('sessionId');
const title = params.get('title') || sessionId || 'Session';
const status = document.getElementById('status');
const statusText = document.getElementById('status-text');
const retry = document.getElementById('retry');
const host = document.getElementById('terminal');
document.getElementById('title').textContent = title;
document.title = `${title} · Agent Wrangler`;

const showStatus = (text, state = 'failed') => {
  status.dataset.state = state;
  status.title = text;
  statusText.textContent = text;
  statusText.classList.toggle('sr-only', state === 'connected');
};

let detachForReturn = () => {};
document.getElementById('board').onclick = async () => {
  const button = document.getElementById('board');
  button.disabled = true;
  retry.disabled = true;
  try {
    const returned = await returnToBoard({ browser: window, sessionId, detach: () => detachForReturn() });
    if (!returned) showStatus('Allow pop-ups to open a new board window, then try again.');
  } catch (error) {
    showStatus(`Could not return to board: ${error.message}`);
  } finally {
    button.disabled = false;
    retry.disabled = false;
  }
};

function start() {
  if (!sessionId) throw new Error('No session selected. Open a terminal from the session’s Actions menu.');
  if (!globalThis.Terminal || !globalThis.FitAddon) {
    throw new Error('Terminal assets could not load. Check your connection and reload this window.');
  }
  const terminal = new Terminal({
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: readFontSize(window.localStorage, normalizeFontSize),
    cursorBlink: true,
    allowProposedApi: true,
    allowTransparency: true,
    macOptionClickForcesSelection: true,
    theme: readTerminalTheme(),
    linkHandler: { activate: (_event, uri) => window.open(uri, '_blank', 'noopener,noreferrer') },
  });
  const fit = new FitAddon.FitAddon();
  terminal.loadAddon(fit);
  if (globalThis.WebLinksAddon) terminal.loadAddon(new WebLinksAddon.WebLinksAddon(
    (_event, uri) => window.open(uri, '_blank', 'noopener,noreferrer')));
  if (globalThis.Unicode11Addon) {
    terminal.loadAddon(new Unicode11Addon.Unicode11Addon());
    terminal.unicode.activeVersion = '11';
  }
  if (globalThis.ClipboardAddon) terminal.loadAddon(new ClipboardAddon.ClipboardAddon(undefined, {
    readText: () => Promise.resolve(''),
    writeText: (_selection, text) => navigator.clipboard?.writeText(text).catch(() => {}),
  }));
  terminal.open(host);

  let connection = null;
  const theme = createThemeSync({ browser: window, storage: window.localStorage, terminal, normalizeFontSize,
    themeApi: { selectStyle, setCustomStyles, readTerminalTheme, onThemeChange },
    onResize: () => connection?.resize() });
  connection = createTerminalRecovery({
    createConnection: ({ onOpen, onClose }) => connectTerminal({ location, sessionId, terminal, fit, WebSocket,
      onOpen() { terminal.reset(); theme.refresh(); onOpen(); }, onClose }),
    onState(state) {
      const labels = { connecting: 'Connecting…', connected: 'Connected', reconnecting: 'Reconnecting…', failed: 'Disconnected' };
      showStatus(labels[state], state);
      retry.hidden = state !== 'failed';
    },
  });
  retry.onclick = () => { if (!connection.retry()) location.reload(); };
  host.onclick = () => terminal.focus();
  terminal.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown') return true;
    const bytes = event.key === 'Enter' && event.shiftKey ? '\x1b\r'
      : event.metaKey && !event.shiftKey && event.key === 'ArrowLeft' ? '\x1bb'
        : event.metaKey && !event.shiftKey && event.key === 'ArrowRight' ? '\x1bf'
          : event.metaKey && event.key === 'Backspace' ? '\x15' : null;
    if (!bytes) return true;
    connection?.send(bytes);
    event.preventDefault();
    return false;
  });
  const observer = new ResizeObserver(() => connection?.resize());
  observer.observe(host);
  const resize = () => connection?.resize();
  window.addEventListener('resize', resize);
  document.fonts?.ready.then(resize);
  detachForReturn = () => {
    theme.dispose();
    observer.disconnect();
    window.removeEventListener('resize', resize);
    return connection?.dispose();
  };
  window.addEventListener('pagehide', () => {
    detachForReturn();
    terminal.dispose();
  }, { once: true });
  connection.start();
}

try { start(); } catch (error) {
  showStatus(error.message);
  retry.hidden = false;
  retry.onclick = () => location.reload();
}
