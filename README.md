# Agent Wrangler session pop-out

An [Agent Wrangler](https://github.com/PortSwigger/agent-wrangler) extension that opens live terminals in movable, resizable windows.

- Pop out from a session’s **Actions** or right-click menu.
- Return to the board using the icon in the window header.
- Follows Wrangler’s theme, wallpaper, and font settings.
- Reconnects automatically; closing the window leaves the agent running.
- Reopening a session focuses its existing window.

Requires host API **^1.31.0**. Supports live terminals only.

## Shortcuts

| Keys | Action |
| --- | --- |
| **Control + Command + O (⌃⌘O)** | Pop out the selected live terminal |

Listed under **Settings → Shortcuts → Session pop-out**.

## Install

Open **Settings → Extensions → + Add extension** and install by Git URL:

```text
https://github.com/charlie-meek-ps/agent-wrangler-session-popout
```

Enable **Session pop-out**. Allow pop-ups for Wrangler if prompted.

## Tests

```sh
npm test
```

Requires Node.js 20+. No dependencies or build step. Tests cover window handoff, shortcuts, terminal sizing, reconnection, and theme updates.

## Licence

MIT. Bundled favicon: Apache-2.0 (see [NOTICE](NOTICE)).
