// Reserve a destination before detaching so a blocked new window never strands
// the user. Wait for the pop-out client to close before the board attaches.
export async function returnToBoard({ browser, sessionId, detach }) {
  const url = new URL('/', browser.location.href);
  url.hash = `session=${encodeURIComponent(sessionId)}`;
  let board;
  try {
    const opener = browser.opener;
    if (opener && !opener.closed && opener.location.origin === url.origin) board = opener;
  } catch { /* An opener navigated elsewhere; use a new local board window. */ }
  const existingBoard = Boolean(board);
  if (!board) board = browser.open('about:blank', '_blank');
  if (!board) return false;
  board.focus();
  await detach();
  if (existingBoard) board.location.hash = url.hash;
  else board.location.href = url.href;
  browser.close();
  return true;
}
