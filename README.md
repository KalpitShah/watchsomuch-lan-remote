# WatchSoMuch LAN Remote 📺📱

Control the WatchSoMuch video player on your **laptop** from your **phone**, over your
local network (home Wi‑Fi **or** a mobile hotspot).

Tap **Play/Pause**, seek **±10s**, change **playback speed** (1.25× / 1.5× / 2×),
toggle **captions**, jump to the **next episode**, or go **fullscreen** — all from
a clean, dark remote in your phone's browser. No app store, no accounts, nothing
leaves your network.

```
 ┌──────────────┐    POST /command     ┌──────────────┐    GET /poll     ┌──────────────────┐
 │  Your phone  │ ───────────────────▶ │ Relay server │ ◀─────────────── │ Chrome extension │
 │  (remote UI) │                      │  (your PC)   │                  │  (controls video)│
 └──────────────┘                      └──────────────┘                  └──────────────────┘
```

The three pieces:

| Folder        | What it is                                                                 |
| ------------- | -------------------------------------------------------------------------- |
| `server/`     | A tiny Node.js relay server. Serves the phone remote **and** passes commands along. |
| `extension/`  | A Chrome extension that polls the server and controls the WatchSoMuch `<video>`. |
| `server/public/` | The mobile remote web page (pure HTML/CSS/JS, no frameworks).            |

---

## Setup — step by step

### 1. Install Node.js (if you don't have it)

Download and install the **LTS** version from <https://nodejs.org>.
To check it's installed, open a terminal and run:

```bash
node --version
```

You should see something like `v20.x.x`.

### 2. Start the relay server

In a terminal:

```bash
cd server
node index.js
```

You'll see output like this:

```
  📺  WatchSoMuch LAN Remote — relay server is running!
  ----------------------------------------------------
  On THIS laptop you can open:   http://localhost:3000
  On your PHONE open one of these (same Wi-Fi / hotspot):
        http://192.168.43.5:3000
  ----------------------------------------------------
  Waiting for commands…
```

### 3. Note your laptop's IP address

Look at the line printed under **"On your PHONE open one of these"**. On a
**mobile hotspot** it usually looks like `192.168.43.x`. On home Wi‑Fi it's
often `192.168.0.x` or `192.168.1.x`. You'll type this into your phone in step 6.

> Leave this terminal window open — the server needs to keep running. Each command
> your phone sends is logged here, so you can watch the activity live.

### 4. Load the Chrome extension

1. Open Chrome and go to `chrome://extensions`.
2. Turn on **Developer mode** (toggle in the top‑right).
3. Click **Load unpacked**.
4. Select the **`extension`** folder from this project.

The extension is now installed. It quietly does nothing until you actually open
WatchSoMuch (see next step).

### 5. Open WatchSoMuch and start playing

In the same Chrome on your laptop, open WatchSoMuch and start playing an episode
or movie. The extension only "wakes up" and starts listening for remote commands
while a WatchSoMuch tab is open.

### 6. Open the remote on your phone

Make sure your phone is on the **same Wi‑Fi / hotspot** as the laptop. Then open
your phone's browser and go to:

```
http://[laptop-ip]:3000
```

…replacing `[laptop-ip]` with the address from step 3, e.g. `http://192.168.43.5:3000`.

### 7. Use the controller 🎉

Tap the big button to **play/pause**, use **−10s / +10s** to seek, pick a
**playback speed** (1×, 1.25×, 1.5×, 2×), toggle **Captions** on/off, jump to the
**Next Episode**, or toggle **Fullscreen**. The little dot at the bottom turns
**mint** when a command was delivered and **red** if it couldn't reach the server.

---

## Using it on a mobile hotspot

This works great over a phone hotspot. When your laptop connects to your phone's
hotspot, both devices are on the **same LAN** that the hotspot creates — so the
phone can reach the laptop at its `192.168.43.x` address. Nothing goes out to the
internet; the commands travel directly phone → laptop.

(If you turn the hotspot off and reconnect later, the laptop's IP may change —
just re-check the terminal output and use the new address.)

---

## Troubleshooting

**The phone says "Not connected — is the server running?"**

- Make sure the `node index.js` terminal is still open and running.
- Double‑check you typed the **exact IP** from the terminal, including `:3000`.
- Confirm the phone and laptop are on the **same network** (same Wi‑Fi name, or
  laptop connected to the phone's hotspot).

**Firewall is blocking the connection**

The server listens on **port 3000**. A firewall on your laptop can block your phone
from reaching it:

- **Windows:** the first time you run the server, Windows may pop up a
  *"Allow Node.js to communicate on these networks"* dialog — tick **Private
  networks** and click **Allow access**. If you missed it, go to *Windows Defender
  Firewall → Allow an app through firewall* and enable Node.js, or add an inbound
  rule for **TCP port 3000**.
- **macOS:** go to *System Settings → Network → Firewall*. Either allow incoming
  connections for **node**, or temporarily turn the firewall off to test. macOS
  usually shows an *"Allow incoming network connections"* prompt the first run —
  click **Allow**.

**Buttons do nothing even though the phone says "Sent ✓"**

- Make sure a **WatchSoMuch tab is open and playing** in Chrome on the laptop —
  the extension only acts while such a tab exists.
- Open `chrome://extensions`, find **WatchSoMuch LAN Remote**, and click the
  **service worker** link to view its console for any logged errors.
- Fullscreen may occasionally be blocked by the browser if it wants a direct
  click; the extension falls back to simulating the **`f`** key, which most players
  treat as fullscreen.

**I'm on a different WatchSoMuch mirror domain**

All the common WatchSoMuch mirror domains are already covered
(`.to`, `.tv`, `.org`, `.net`, `.me`, `.com`, `.cc`, `.info`). If WatchSoMuch
moves to a brand‑new domain, add it in two places and reload the extension:

1. `extension/manifest.json` → `host_permissions`
2. `extension/background.js` → `WATCHSOMUCH_MATCHES`

---

## How it works (for maintainers)

- **`server/index.js`** — a zero‑dependency Node HTTP server. It serves the remote
  page from `server/public/`, accepts `POST /command` from the phone (pushing the
  action onto a small queue), and lets the extension drain that queue via
  `GET /poll`. Every received command is logged with a timestamp.
- **`server/public/`** — the remote UI. `app.js` sends each tap as a
  `fetch('/command', …)` and updates the status dot based on whether the request
  succeeded.
- **`extension/background.js`** — a Manifest V3 service worker. It polls
  `GET /poll` **only while a WatchSoMuch tab is open**, then injects a small
  control function into the page with `allFrames: true` (so it also reaches the
  player when it's embedded in an `<iframe>`). A 30‑second alarm keeps the worker
  alive / restarts the loop if Chrome puts it to sleep.

All commands are simple action strings shared by the UI, server, and extension:
`playpause`, `seek-back`, `seek-forward`, `next`, `fullscreen`,
`speed-1`, `speed-1.25`, `speed-1.5`, `speed-2`, and `captions`.

Speed actions set `video.playbackRate`; `captions` toggles the video's text
tracks (falling back to clicking the player's own CC button if no tracks are
exposed).

---

## License

MIT — do whatever you like.
