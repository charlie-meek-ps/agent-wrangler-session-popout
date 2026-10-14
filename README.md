# Agent Wrangler session pop-out

An [Agent Wrangler](https://github.com/PortSwigger/agent-wrangler) extension that adds **Pop out terminal** to live
sessions’ Actions and right-click menus. Each session gets its own movable,
resizable browser window. Opening it again focuses the existing window.

## Install

In Wrangler, open **Settings → Extensions → + Add extension** and install by Git URL:

```text
https://github.com/charlie-meek-ps/agent-wrangler-session-popout
```

Enable **Session pop-out**, select a live session, then choose **Actions → Pop out terminal**
or right-click the session card. Allow pop-ups for Wrangler if your browser blocks the window.

Requires Wrangler host API **^1.31.0**. No npm dependencies or build step.

## Use

Select a live session and press **Control + Command + O (⌃⌘O)** to pop it out.
The shortcut works while the terminal has focus, is listed under
**Settings → Shortcuts → Session pop-out**, and is inactive in dialogs, other
text fields, or when no live session is selected. Holding the keys does not
repeatedly open windows.

The window attaches to the same running agent. If that session is open in the
board, opening its pop-out closes the embedded view and exits fullscreen, so
only the pop-out sets the terminal size. A blocked pop-up leaves the board view
alone; opening a different session's pop-out leaves the selected card alone.
The card stays on its task. Closing or reconnecting the pop-out does not restart
or stop the session. The **Return to board** icon in the upper-right corner detaches
the pop-out, reopens the same session in the original
board, and closes the pop-out. If the original board has closed, it opens a new
board tab on that session. If that tab is blocked, the pop-out stays connected.
Your browser may choose a tab instead of a window.

Lost terminal connections reconnect automatically with five attempts and increasing
delays. **Retry** appears only after those attempts fail; it starts a new recovery
cycle. A green status dot means connected. Returning to the board or closing the
pop-out cancels recovery, so it cannot reattach behind the main window.

The pop-out inherits Wrangler’s selected dark, light, or custom theme, including
the terminal palette, header colours, UI font, and wallpaper. Terminal font size
also follows Wrangler’s setting. Theme and size changes in another Wrangler
window update the pop-out live; the last selected style still works after the
original board closes.

## Development

Run `npm test` with Node.js 20 or newer. Tests cover window reuse and handoff,
shortcuts, terminal streaming and sizing messages, bounded recovery, theme
synchronisation, and the entry module's UI wiring. There is no dependency install.

Use an isolated Wrangler instance for development. From this directory:

```sh
mkdir -p /private/tmp/aw-session-popout-dev/extensions/session-popout
rsync -a --exclude=.git --exclude=node_modules ./ /private/tmp/aw-session-popout-dev/extensions/session-popout/
../agent-wrangler/bin/agent-wrangler --data-dir /private/tmp/aw-session-popout-dev --port 7999 --open
```

Re-run the `rsync` command after edits. Refresh browser assets; restart the dev
instance after manifest changes. Start a session in that instance, then choose
**Actions → Pop out terminal**. Verify input, resizing, reconnecting, two different
sessions, reopening the same session, and closing the window while the agent works.

The installed folder must be named `session-popout`, matching the manifest id.
The repository directory is `agent-wrangler-session-popout`.

## Compatibility and scope

Targets host API `^1.31.0`. The menu uses the supported `card.action` slot, while
terminal streaming uses Wrangler’s existing internal `/pty?sessionId=…` WebSocket
protocol (text or binary output, raw input, JSON resize frames). The handoff clears
the board's `#session` URL route, using its existing deselection behavior. This
endpoint and the vendored addon asset paths are not a versioned extension API;
verify them when
upgrading Wrangler. Theme inheritance uses the host’s served `styles.css`,
`theme.js`, and `term-font.js` browser helpers, which also need checking when
upgrading. No server core imports or host changes are required.

The extension shows terminals for already-live sessions. It does not resume
dormant sessions or include the transcript-backed chat pane, drag-to-pop-out,
image paste or board acknowledgement. Terminal and fit assets use the same
pinned CDN versions as Wrangler, so loading needs internet.
An existing window stays attached when the extension is disabled; disabling stops
new menu actions and asset requests. Both the board and pop-out may view the same
terminal if you explicitly reopen the session on the board while its pop-out is
open. Those clients share tmux’s size, so keep one terminal view open at a time.

## Licence

Extension code is MIT licensed. The bundled Wrangler favicon is Apache-2.0 licensed;
see [NOTICE](NOTICE) and [LICENSES/Apache-2.0.txt](LICENSES/Apache-2.0.txt).
