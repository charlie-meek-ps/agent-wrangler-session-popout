const STYLE_KEY = 'cm-style';
const FONT_KEY = 'cm-term-fontsize';

function read(storage, key) {
  try { return storage?.getItem(key); } catch { return null; }
}

export function readFontSize(storage, normalizeFontSize) {
  return normalizeFontSize(read(storage, FONT_KEY));
}

// The browser's shared theme helper applies base colours, custom variables,
// fonts and wallpapers. This adapter keeps its terminal and storage in sync.
export function createThemeSync({ browser, storage, terminal, themeApi, normalizeFontSize, onResize,
  fetchStyles = () => fetch('/api/styles').then((response) => {
    if (!response.ok) throw new Error('Style catalogue unavailable');
    return response.json();
  }) }) {
  let disposed = false;
  let sequence = 0;
  let frame = null;

  const resize = () => {
    if (frame !== null || disposed) return;
    frame = browser.requestAnimationFrame(() => {
      frame = null;
      if (!disposed) onResize();
    });
  };
  const syncTerminal = () => {
    if (disposed) return;
    terminal.options.theme = themeApi.readTerminalTheme();
    terminal.options.fontSize = readFontSize(storage, normalizeFontSize);
    resize();
  };
  const styleId = () => read(storage, STYLE_KEY)
    || (read(storage, 'cm-theme') === 'light' ? 'light' : 'dark');
  const refreshStyle = async () => {
    if (disposed) return;
    const id = ++sequence;
    const selected = styleId();
    // Built-ins don't need the catalogue; custom styles must be loaded before
    // selection so a rapid change during startup cannot overwrite it as Dark.
    if (selected === 'dark' || selected === 'light') {
      try { themeApi.selectStyle(selected); } catch {}
      return;
    }
    try {
      const data = await fetchStyles();
      if (disposed || id !== sequence) return;
      const wanted = styleId();
      themeApi.setCustomStyles(data.styles);
      themeApi.selectStyle(wanted);
    } catch { /* Keep the current palette through a temporary app outage. */ }
  };
  const onStorage = (event) => {
    if (event.storageArea && event.storageArea !== storage) return;
    if (event.key === STYLE_KEY || event.key === 'cm-theme' || event.key === null) refreshStyle();
    if (event.key === FONT_KEY || event.key === null) syncTerminal();
  };
  themeApi.onThemeChange(syncTerminal);
  browser.addEventListener('storage', onStorage);
  refreshStyle();
  syncTerminal();

  return {
    refresh() { syncTerminal(); return refreshStyle(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      sequence++;
      browser.removeEventListener('storage', onStorage);
      themeApi.onThemeChange(null);
      if (frame !== null) browser.cancelAnimationFrame(frame);
    },
  };
}
