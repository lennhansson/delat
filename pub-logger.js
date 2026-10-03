const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, 'data', 'pub-logs');
const MAX_LOG_ITEMS = 25;

function safePubId(pubId) {
  return String(pubId || 'unknown').trim().replace(/[^a-z0-9_-]/gi, '_').toLowerCase() || 'unknown';
}

function ensureLogDirectory() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function readPubLog(pubId) {
  const safeId = safePubId(pubId);
  const logPath = path.join(LOG_DIR, `${safeId}.json`);

  if (!fs.existsSync(logPath)) return [];

  try {
    const raw = fs.readFileSync(logPath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

function trackPubEvent(pubId, type, message, options = {}) {
  const safeId = safePubId(pubId);
  ensureLogDirectory();

  const entry = {
    timestamp: new Date().toISOString(),
    type: String(type || 'unknown'),
    message: String(message || 'No message'),
    recovered: !!options.recovered,
    source: String(options.source || 'server'),
    details: options.details ? String(options.details) : ''
  };

  const logPath = path.join(LOG_DIR, `${safeId}.json`);
  const entries = readPubLog(safeId);
  entries.push(entry);

  if (entries.length > MAX_LOG_ITEMS) {
    entries.splice(0, entries.length - MAX_LOG_ITEMS);
  }

  fs.writeFileSync(logPath, JSON.stringify(entries, null, 2));
  return entry;
}

module.exports = {
  LOG_DIR,
  safePubId,
  readPubLog,
  trackPubEvent
};
