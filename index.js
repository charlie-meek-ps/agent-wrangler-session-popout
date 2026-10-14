import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const dir = path.dirname(fileURLToPath(import.meta.url));

export default {
  id: 'session-popout',
  label: 'Session pop-out',
  description: 'Open live agent terminals in separate windows without restarting their sessions.',
  author: 'Charlie Meek',
  homepage: 'https://github.com/charlie-meek-ps/agent-wrangler-session-popout',
  requires: [],
  engines: { wranglerApi: '^1.31.0' },
  defaultEnabled: true,
  keybindings: [{ combo: 'ctrl+cmd+o', scope: 'board' }],
  dir,
  client: 'public/index.js',
};
