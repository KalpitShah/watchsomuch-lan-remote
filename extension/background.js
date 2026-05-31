/* ============================================================
   WatchSoMuch LAN Remote — Chrome extension (background worker)
   ------------------------------------------------------------
   This service worker repeatedly asks the relay server "any commands?"
   (GET /poll). When a command arrives, it runs a small function inside
   the WatchSoMuch tab to control the <video> element.

   Two important design points called out in the project notes:

     1. We only poll while there is an open WatchSoMuch tab, so we don't
        hammer the server (or the network) when you're not watching anything.

     2. WatchSoMuch sometimes embeds its player inside an <iframe>. We use
        `allFrames: true` so our control function runs in every frame and
        can reach the video wherever it lives.
   ============================================================ */

// Where the relay server lives. It runs on the same laptop as Chrome, so
// localhost is correct here (the *phone* uses the LAN IP, the extension does not).
const POLL_URL = 'http://localhost:3000/poll';

// How often to check for new commands, in milliseconds. ~700ms feels responsive
// without being wasteful.
const POLL_INTERVAL_MS = 700;

// URL patterns that identify a WatchSoMuch tab (mirror domains included).
const WATCHSOMUCH_MATCHES = [
  '*://*.watchsomuch.to/*',
  '*://*.watchsomuch.tv/*',
  '*://*.watchsomuch.org/*',
  '*://*.watchsomuch.net/*',
  '*://*.watchsomuch.me/*',
  '*://*.watchsomuch.com/*',
  '*://*.watchsomuch.cc/*',
  '*://*.watchsomuch.info/*',
];

// Guards against two poll loops running at once.
let pollTimer = null;

/* ------------------------------------------------------------------ */
/*  Finding the WatchSoMuch tab                                        */
/* ------------------------------------------------------------------ */

/**
 * Return the open WatchSoMuch tabs (may be empty). We prefer the active /
 * focused one so commands go to the video you're actually looking at.
 */
async function findWatchSoMuchTabs() {
  const tabs = await chrome.tabs.query({ url: WATCHSOMUCH_MATCHES });
  // Put active tabs first so we target the one in focus when there are several.
  return tabs.sort((a, b) => Number(b.active) - Number(a.active));
}

/* ------------------------------------------------------------------ */
/*  The function that actually controls the video                     */
/*  (this gets injected into the page, so it must be self-contained)  */
/* ------------------------------------------------------------------ */

/**
 * Runs INSIDE the WatchSoMuch page (and every iframe). Finds the video and
 * applies the requested action. Returns true if it found a video to act on.
 *
 * NOTE: because this is injected via chrome.scripting.executeScript, it cannot
 * reference anything from the outer file — everything it needs is in here.
 */
function controlVideoInPage(action) {
  // Grab the most likely "main" video: the one that's biggest / actually playing.
  const videos = Array.from(document.querySelectorAll('video'));
  if (videos.length === 0) {
    // No <video> in this frame. Still try the "next episode" click handling
    // below, since the next button might live in a frame without a video.
  }

  // Pick the best video candidate: prefer one that is playing, otherwise the
  // largest one on screen.
  function pickVideo() {
    if (videos.length === 0) return null;
    const playing = videos.find((v) => !v.paused && !v.ended);
    if (playing) return playing;
    return videos.sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight))[0];
  }

  const video = pickVideo();

  switch (action) {
    case 'playpause': {
      if (!video) return false;
      if (video.paused) {
        video.play();
      } else {
        video.pause();
      }
      return true;
    }

    case 'seek-back': {
      if (!video) return false;
      video.currentTime = Math.max(0, video.currentTime - 10);
      return true;
    }

    case 'seek-forward': {
      if (!video) return false;
      const limit = isFinite(video.duration) ? video.duration : Number.MAX_SAFE_INTEGER;
      video.currentTime = Math.min(limit, video.currentTime + 10);
      return true;
    }

    case 'fullscreen': {
      if (!video) return false;
      try {
        if (document.fullscreenElement) {
          document.exitFullscreen();
        } else {
          // Try the standard API first, then the WebKit fallback some players use.
          const target = video.closest('.video-wrapper, .player, .jw-wrapper') || video;
          if (target.requestFullscreen) {
            target.requestFullscreen();
          } else if (target.webkitRequestFullscreen) {
            target.webkitRequestFullscreen();
          } else if (video.webkitEnterFullscreen) {
            // iOS-style fullscreen on the video element itself.
            video.webkitEnterFullscreen();
          }
        }
      } catch (e) {
        // Browsers may block programmatic fullscreen without a user gesture.
        // As a fallback, simulate pressing the "f" key, which most web players
        // map to fullscreen.
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', bubbles: true }));
      }
      return true;
    }

    case 'next': {
      // "Next episode" is site-specific. We try a few common patterns:
      //   1. A link/button whose text says "next".
      //   2. Common player "next" control classes.
      // This is best-effort and easy to tweak if WatchSoMuch changes their UI.
      const candidates = Array.from(
        document.querySelectorAll('a, button, [role="button"], .jw-icon-next, .next, .btn-next, .next-episode')
      );

      const nextEl = candidates.find((el) => {
        const text = (el.textContent || '').trim().toLowerCase();
        const aria = (el.getAttribute('aria-label') || '').toLowerCase();
        const title = (el.getAttribute('title') || '').toLowerCase();
        const cls = (el.className || '').toString().toLowerCase();
        return (
          text === 'next' ||
          text.includes('next episode') ||
          aria.includes('next') ||
          title.includes('next') ||
          cls.includes('next')
        );
      });

      if (nextEl) {
        nextEl.click();
        return true;
      }
      return false;
    }

    case 'speed-1':
    case 'speed-1.25':
    case 'speed-1.5':
    case 'speed-2': {
      // Action looks like "speed-1.5" → take the number after the dash.
      if (!video) return false;
      const rate = parseFloat(action.split('-')[1]);
      if (!isNaN(rate)) video.playbackRate = rate;
      return true;
    }

    case 'captions': {
      // Toggle subtitles/closed-captions on or off.
      //
      // The standard way is via the video's text tracks: each track has a
      // `mode` of 'showing' | 'hidden' | 'disabled'. If any track is currently
      // showing we turn them all off; otherwise we turn the best track on.
      const tracks = video && video.textTracks ? Array.from(video.textTracks) : [];

      if (tracks.length > 0) {
        const anyShowing = tracks.some((t) => t.mode === 'showing');
        if (anyShowing) {
          tracks.forEach((t) => { t.mode = 'hidden'; });
        } else {
          // Prefer an actual subtitles/captions track over, say, a metadata one.
          const target =
            tracks.find((t) => t.kind === 'subtitles' || t.kind === 'captions') || tracks[0];
          target.mode = 'showing';
        }
        return true;
      }

      // Fallback: no text tracks exposed, so click the player's own CC button.
      // This is best-effort and easy to tweak if WatchSoMuch changes their UI.
      const ccCandidates = Array.from(
        document.querySelectorAll(
          'button, [role="button"], .jw-icon-cc, .vjs-subs-caps-button, .captions, .subtitle, [class*="caption"], [class*="subtitle"]'
        )
      );
      const ccEl = ccCandidates.find((el) => {
        const text = (el.textContent || '').trim().toLowerCase();
        const aria = (el.getAttribute('aria-label') || '').toLowerCase();
        const title = (el.getAttribute('title') || '').toLowerCase();
        const cls = (el.className || '').toString().toLowerCase();
        return (
          text === 'cc' ||
          aria.includes('caption') || aria.includes('subtitle') ||
          title.includes('caption') || title.includes('subtitle') ||
          cls.includes('caption') || cls.includes('subtitle') || cls.includes('cc')
        );
      });
      if (ccEl) {
        ccEl.click();
        return true;
      }
      return false;
    }

    default:
      return false;
  }
}

/* ------------------------------------------------------------------ */
/*  Running a command across the WatchSoMuch tab(s)                    */
/* ------------------------------------------------------------------ */

/**
 * Inject `controlVideoInPage` into the WatchSoMuch tab — in every frame — and
 * pass it the action to perform.
 */
async function runCommand(action) {
  const tabs = await findWatchSoMuchTabs();
  if (tabs.length === 0) return;

  // Only target the front-most matching tab to avoid double-triggering on,
  // say, two open episodes.
  const tab = tabs[0];

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true }, // allFrames handles embedded players
      func: controlVideoInPage,
      args: [action],
    });
    console.log(`[remote] executed "${action}" on tab ${tab.id}`);
  } catch (err) {
    console.warn(`[remote] could not run "${action}":`, err.message);
  }
}

/* ------------------------------------------------------------------ */
/*  The polling loop                                                   */
/* ------------------------------------------------------------------ */

/**
 * One polling tick: only contacts the server if a WatchSoMuch tab is open.
 */
async function pollOnce() {
  const tabs = await findWatchSoMuchTabs();
  if (tabs.length === 0) {
    // No WatchSoMuch tab — stay quiet and don't bother the server.
    return;
  }

  try {
    const res = await fetch(POLL_URL, { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    const commands = Array.isArray(data.commands) ? data.commands : [];
    // Run each queued command in the order it was received.
    for (const action of commands) {
      await runCommand(action);
    }
  } catch (err) {
    // Server not running / unreachable. That's fine — we'll try again next tick.
  }
}

/**
 * Start the recurring poll loop (if it isn't already running). We use a
 * self-rescheduling setTimeout rather than setInterval so a slow tick can't
 * stack up behind the next one.
 */
function startPolling() {
  if (pollTimer !== null) return;

  const loop = async () => {
    await pollOnce();
    pollTimer = setTimeout(loop, POLL_INTERVAL_MS);
  };

  loop();
  console.log('[remote] polling started');
}

/* ------------------------------------------------------------------ */
/*  Service-worker lifecycle / keep-alive                             */
/* ------------------------------------------------------------------ */
/*
   In Manifest V3 the background script is a service worker that Chrome can
   stop when it looks idle. To make sure the remote keeps working while you're
   watching, we:
     • start polling as soon as the worker wakes up, and
     • register a recurring alarm that wakes the worker back up and restarts
       the loop if Chrome ever put it to sleep.
*/

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('keepAlive', { periodInMinutes: 0.5 }); // 30s is the MV3 minimum
  startPolling();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('keepAlive', { periodInMinutes: 0.5 });
  startPolling();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive') {
    // If the worker was asleep, this listener waking it is enough; make sure
    // the poll loop is running again.
    startPolling();
  }
});

// Also kick things off when this file is first evaluated (covers the case where
// the worker is spun up by an event without onInstalled/onStartup firing).
startPolling();
