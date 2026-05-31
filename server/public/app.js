/* ============================================================
   WatchSoMuch Remote — controller logic
   ------------------------------------------------------------
   Each button tap POSTs a command to the relay server and the status
   bar reflects whether it was delivered. Two controls also keep a little
   local UI state for nicer feedback:
     • the speed segmented control highlights the chosen speed, and
     • the captions bar flips an on/off switch.
   Pure vanilla JS.
   ============================================================ */

(function () {
  'use strict';

  // The page is served by the relay server, so commands go back to the same
  // origin (e.g. http://192.168.43.5:3000). No hardcoded IP needed.
  const COMMAND_URL = '/command';

  const statusEl = document.getElementById('status');
  const statusText = document.getElementById('statusText');
  const ccBtn = document.getElementById('ccBtn');

  // Timer that resets the status back to "Ready" after a moment.
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
   * Give a button a brief "tapped" highlight on top of the CSS :active state
   * (which only lasts while the finger is held down).
   */
  function flash(button) {
    button.classList.add('tapped');
    setTimeout(() => button.classList.remove('tapped'), 150);
  }

  /**
   * Send a command to the relay server.
   * @param {string} action  e.g. playpause, seek-back, speed-1.5, captions …
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
      setStatus('ok', 'Sent');
    } catch (err) {
      // Most common cause: the laptop server isn't reachable (wrong IP, firewall,
      // not on the same network).
      setStatus('err', 'Not connected — is the server running?');
    } finally {
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => setStatus('idle', 'Ready'), 1800);
    }
  }

  /**
   * For grouped controls (the speed segments), mark the tapped button as the
   * single active one within its group.
   */
  function setActiveInGroup(button) {
    const group = button.dataset.group;
    document
      .querySelectorAll(`[data-group="${group}"]`)
      .forEach((el) => el.classList.toggle('is-active', el === button));
  }

  // Wire up every button that carries a data-action.
  document.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', () => {
      flash(button);

      // Segmented control: update the highlighted selection.
      if (button.dataset.group) setActiveInGroup(button);

      // Captions toggle: flip the on/off switch optimistically. The extension
      // toggles the real captions; if they ever drift, another tap re-syncs.
      if (button === ccBtn) {
        const on = ccBtn.classList.toggle('is-on');
        ccBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      }

      sendCommand(button.dataset.action);
    });
  });
})();
