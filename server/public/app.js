/* ============================================================
   WatchSoMuch Remote — controller logic
   Pure vanilla JS. Each button tap POSTs a command to the relay
   server, and we show whether it was delivered in the status bar.
   ============================================================ */

(function () {
  'use strict';

  // The page is served by the relay server, so commands go back to the same
  // origin (e.g. http://192.168.43.5:3000). No hardcoded IP needed.
  const COMMAND_URL = '/command';

  const statusEl = document.getElementById('status');
  const statusText = document.getElementById('statusText');

  // Holds the timer that resets the status back to "Ready" after a moment.
  let resetTimer = null;

  /**
   * Update the bottom status indicator.
   * @param {'sending'|'ok'|'err'|'idle'} state
   * @param {string} message
   */
  function setStatus(state, message) {
    statusEl.classList.remove('is-ok', 'is-err', 'is-sending');
    if (state === 'sending') statusEl.classList.add('is-sending');
    if (state === 'ok') statusEl.classList.add('is-ok');
    if (state === 'err') statusEl.classList.add('is-err');
    statusText.textContent = message;
  }

  /**
   * Give a button a brief visual "tapped" highlight, in addition to the CSS
   * :active state (which only lasts while the finger is down).
   */
  function flash(button) {
    button.classList.add('tapped');
    setTimeout(() => button.classList.remove('tapped'), 150);
  }

  /**
   * Send a command to the relay server.
   * @param {string} action  one of: playpause, seek-back, seek-forward, next, fullscreen
   */
  async function sendCommand(action) {
    setStatus('sending', 'Sending…');
    try {
      const res = await fetch(COMMAND_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });

      if (!res.ok) throw new Error('Server responded ' + res.status);

      setStatus('ok', 'Sent ✓');
    } catch (err) {
      // Most common cause: the laptop server isn't reachable (wrong IP, firewall,
      // not on the same network). Tell the user plainly.
      setStatus('err', 'Not connected — is the server running?');
    } finally {
      // Fade the status back to a neutral "Ready" after a short delay so the
      // indicator doesn't get stuck on a stale message.
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => setStatus('idle', 'Ready'), 1800);
    }
  }

  // Wire up every button that has a data-action attribute.
  document.querySelectorAll('.btn[data-action]').forEach((button) => {
    button.addEventListener('click', () => {
      flash(button);
      sendCommand(button.dataset.action);
    });
  });
})();
