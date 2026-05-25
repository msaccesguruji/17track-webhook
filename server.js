/**
 * 17track Webhook Relay (Render service)
 *
 * Sits between 17track and our Apps Script main webapp. Purpose: absorb
 * 17track's tight timeout (~3s) by responding 200 immediately, and
 * forward the payload to Apps Script asynchronously (which has 2-4s
 * cold starts on a free tier and would otherwise cause 17track to
 * timeout with 504).
 *
 * Architecture:
 *   17track → POST /webhook → this relay → 200 OK (instant)
 *                              ↓ async fire-and-forget
 *                              → POST to GOOGLE_SCRIPT_URL with the
 *                                ORIGINAL raw body, unchanged
 *
 * We forward the body untouched (rather than parsing it into a flat
 * shape) so the main app's existing 17track parser handles the full
 * payload including the events timeline — no data loss.
 *
 * Setup:
 *   1. Set env vars on Render:
 *      - GOOGLE_SCRIPT_URL : your main webapp's deployment URL
 *      - SHARED_SECRET     : random string (also set in main app Settings)
 *   2. 17track webhook URL points at https://<your-render>.onrender.com/webhook
 *   3. The main app validates the SHARED_SECRET to ensure only this
 *      relay can trigger its tracking-update endpoint
 */

const express = require('express');
const https = require('https');

const app = express();

// Read body as raw bytes so we can forward exactly what 17track sent,
// without re-serializing (which can change key order, drop unknown
// fields, or alter number formatting in ways the main app's parser
// might choke on).
app.use(express.raw({ type: 'application/json', limit: '5mb' }));

const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL || '';
const SHARED_SECRET = process.env.SHARED_SECRET || '';

if (!GOOGLE_SCRIPT_URL) {
  console.warn('[startup] GOOGLE_SCRIPT_URL env var not set — forwards will fail');
}

app.post('/webhook', (req, res) => {
  // Always acknowledge 17track in <100ms so they never retry on us.
  res.status(200).json({ status: 'ok' });

  // Now forward the original payload to Apps Script. Fire-and-forget —
  // we don't wait for or care about its response. Apps Script can take
  // its 2-4 seconds; 17track has already moved on.
  if (!GOOGLE_SCRIPT_URL) return;

  // express.raw gave us a Buffer; convert to string for logging and
  // for sending the same bytes downstream.
  const rawBody = req.body instanceof Buffer ? req.body.toString('utf8') : '';
  console.log('[webhook] received', rawBody.slice(0, 200) + (rawBody.length > 200 ? '…' : ''));

  // Build the forward URL. Apps Script identifies the request via
  // ?webhook=17track-forwarded so its doPost router knows what to do,
  // and ?secret=... so it can reject random POSTs from the open internet.
  const url = new URL(GOOGLE_SCRIPT_URL);
  url.searchParams.set('webhook', '17track-forwarded');
  if (SHARED_SECRET) url.searchParams.set('secret', SHARED_SECRET);

  const opts = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(rawBody)
    }
  };

  const gReq = https.request(url.toString(), opts, (gRes) => {
    // Drain the response so the socket can be reused / closed cleanly.
    // Don't await or block on this — we already returned to 17track.
    gRes.on('data', () => {});
    gRes.on('end', () => {
      console.log('[forward] apps script responded', gRes.statusCode);
    });
  });

  gReq.on('error', (err) => {
    // Apps Script can be slow or unavailable; log but don't crash.
    // 17track has already received its 200 so this only affects the
    // logging/processing side. If a real event is lost, 17track will
    // retry per their schedule (10/30/60 min).
    console.error('[forward] failed:', err.message);
  });

  gReq.write(rawBody);
  gReq.end();
});

// Health check for Render's load balancer
app.get('/', (req, res) => res.status(200).send('OK'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Relay listening on :${PORT}`));
