const ICON = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 3h7v7M21 3l-10 10M10 3H3v18h18v-7"/></svg>';

export function createPopouts(browser = globalThis.window, api = {}) {
  const windows = new Map();
  const releaseEmbeddedView = (session) => {
    if (api.selectedSessionId?.() === session.sessionId) {
      // Clearing Wrangler's #session route deselects the card, closes only its
      // browser tmux client, and exits fullscreen. Do not close another card.
      browser.location.hash = '';
    }
  };
  return {
    open(session) {
      const existing = windows.get(session.sessionId);
      if (existing && !existing.closed) {
        releaseEmbeddedView(session);
        existing.focus();
        return existing;
      }
      const url = new URL('./popout.html', import.meta.url);
      url.searchParams.set('sessionId', session.sessionId);
      url.searchParams.set('title', session.label || session.intent || session.sessionId);
      const popup = browser.open(url.href, `wrangler-session-${session.sessionId}`,
        'popup=yes,width=1100,height=750,resizable=yes,scrollbars=no');
      if (popup) {
        windows.set(session.sessionId, popup);
        releaseEmbeddedView(session);
        popup.focus();
      }
      return popup;
    },
  };
}

export default {
  register(slots) {
    const popouts = createPopouts(globalThis.window, slots.api);
    let selected = null;
    const open = (session, api = slots.api) => {
      if (!popouts.open(session)) {
        api.ui.notify({
          id: 'popup-blocked',
          title: 'Pop-out blocked',
          body: 'Allow pop-ups for Wrangler, then try the pop-out action again.',
        });
      }
    };
    // Panel updates keep live-session eligibility current without querying or
    // importing core state. This contribution has no visible content.
    slots.register('panel.section', {
      id: 'shortcut-context',
      mount(el) { el.hidden = true; },
      update(_el, session) { selected = session; },
      unmount() { selected = null; },
    });
    slots.api.keys.bind({
      combo: 'ctrl+cmd+o',
      scope: 'board',
      description: 'Pop out the selected session’s terminal',
      when: (event) => !event.repeat && Boolean(selected?.managed)
        && selected.sessionId === slots.api.selectedSessionId(),
      run: () => open(selected),
    });
    slots.register('card.action', {
      id: 'pop-out-terminal',
      items(session, _graph, api) {
        if (!session.managed) return [];
        return [{
          label: 'Pop out terminal',
          icon: ICON,
          hint: '⌃⌘O',
          run: () => open(session, api),
        }];
      },
    });
  },
};
