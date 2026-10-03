const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { trackPubEvent, readPubLog, safePubId } = require('../pub-logger');

const testPubId = 'demo-test-log';
const logPath = path.join(__dirname, '..', 'data', 'pub-logs', `${safePubId(testPubId)}.json`);

test('trackPubEvent writes an entry and keeps the recover flag', () => {
  if (fs.existsSync(logPath)) fs.unlinkSync(logPath);

  const entry = trackPubEvent(testPubId, 'search-timeout', 'Used local fallback', {
    recovered: true,
    source: 'search',
    details: 'timeout'
  });

  const events = readPubLog(testPubId);
  assert.equal(events.length, 1);
  assert.equal(entry.type, 'search-timeout');
  assert.equal(events[0].recovered, true);

  fs.unlinkSync(logPath);
});
