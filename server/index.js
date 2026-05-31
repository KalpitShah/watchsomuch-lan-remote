/**
 * WatchSoMuch LAN Remote — Relay Server
 * --------------------------------------
 * This is a tiny, dependency-free Node.js server. It does three jobs:
 *
 *   1. Serves the mobile controller web page (the remote you tap on your phone).
 *   2. Accepts commands from the phone via  POST /command
 *   3. Hands those commands to the Chrome extension via  GET /poll
 *
 * Flow:
 *
 *   [ Phone browser ] --POST /command--> [ This server ] <--GET /poll-- [ Chrome extension ]
 *                                                                              |
 *                                                                              v
 *                                                                   controls the <video> on
 *                                                                   the WatchSoMuch tab
 *
 * No frameworks are used so you never have to run `npm install`.
 * Just:  cd server && node index.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 3000;

// Folder that holds the mobile controller web page (index.html, styles.css, app.js).
const PUBLIC_DIR = path.join(__dirname, 'public');

/**
 * A simple in-memory queue of commands waiting to be picked up by the extension.
 * The phone pushes commands in (POST /command); the extension pulls them out
 * (GET /poll). We use a queue (not a single value) so that rapid taps are never
 * lost — every tap is delivered in order.
 */
let commandQueue = [];

// Commands the controller is allowed to send. Anything else is rejected.
const VALID_ACTIONS = ['playpause', 'seek-back', 'seek-forward', 'next', 'fullscreen'];

// Map file extensions to the Content-Type we should send back.
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/**
 * Add CORS headers to every response. The Chrome extension polls this server
 * from a different origin (the WatchSoMuch page / the extension itself), so the
 * browser requires us to explicitly allow cross-origin requests.
 */
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

/**
 * Serve a static file from the /public folder. Falls back to a 404 if the file
 * doesn't exist. We keep this deliberately small and only serve files that live
 * inside PUBLIC_DIR (never paths outside it) for safety.
 */
function serveStaticFile(requestPath, res) {
  // "/" means "serve the controller page".
  const safePath = requestPath === '/' ? '/index.html' : requestPath;

  // Resolve the file path and make sure it can't escape the public folder
  // (e.g. a sneaky request for "/../index.js").
  const filePath = path.join(PUBLIC_DIR, path.normalize(safePath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

/**
 * Read the full body of an incoming request and parse it as JSON.
 * Calls back with (error, parsedObject).
 */
function readJsonBody(req, callback) {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    // Guard against absurdly large payloads.
    if (body.length > 1e6) req.destroy();
  });
  req.on('end', () => {
    try {
      callback(null, body ? JSON.parse(body) : {});
    } catch (e) {
      callback(e);
    }
  });
}

const server = http.createServer((req, res) => {
  setCorsHeaders(res);

  // Browsers send a "preflight" OPTIONS request before some cross-origin POSTs.
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  // ---- The phone sends a command here -------------------------------------
  if (req.method === 'POST' && url.pathname === '/command') {
    readJsonBody(req, (err, data) => {
      if (err || !data || !VALID_ACTIONS.includes(data.action)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'invalid action' }));
        return;
      }

      commandQueue.push(data.action);

      // Log every received command so the user can watch activity in the terminal.
      const time = new Date().toLocaleTimeString();
      console.log(`[${time}] 📲 command received: ${data.action}`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  // ---- The Chrome extension picks up pending commands here -----------------
  if (req.method === 'GET' && url.pathname === '/poll') {
    const pending = commandQueue;
    commandQueue = []; // clear the queue now that we've handed them over
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ commands: pending }));
    return;
  }

  // ---- A lightweight health check (handy for debugging) --------------------
  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, queued: commandQueue.length }));
    return;
  }

  // ---- Everything else is treated as a request for the controller page -----
  if (req.method === 'GET') {
    serveStaticFile(url.pathname, res);
    return;
  }

  res.writeHead(405);
  res.end('Method not allowed');
});

/**
 * Find this machine's LAN IP address(es) so the user knows what to type into
 * their phone's browser. On a mobile hotspot these usually look like 192.168.43.x.
 */
function getLanAddresses() {
  const addresses = [];
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      // Skip internal (127.0.0.1) and non-IPv4 addresses.
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push(net.address);
      }
    }
  }
  return addresses;
}

server.listen(PORT, '0.0.0.0', () => {
  const addresses = getLanAddresses();
  console.log('');
  console.log('  📺  WatchSoMuch LAN Remote — relay server is running!');
  console.log('  ----------------------------------------------------');
  console.log(`  On THIS laptop you can open:   http://localhost:${PORT}`);
  if (addresses.length) {
    console.log('  On your PHONE open one of these (same Wi-Fi / hotspot):');
    addresses.forEach((ip) => {
      console.log(`        http://${ip}:${PORT}`);
    });
  } else {
    console.log('  (Could not detect a LAN IP — are you connected to Wi-Fi?)');
  }
  console.log('  ----------------------------------------------------');
  console.log('  Waiting for commands… (press Ctrl+C to stop)');
  console.log('');
});
