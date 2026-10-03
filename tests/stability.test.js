const test = require('node:test');
const assert = require('node:assert/strict');

const {
  withTimeout,
  buildSafeSearchResults,
  hasRecoverableSongCandidate,
  normalizeSongCandidate
} = require('../stability-guards');

test('withTimeout resolves to fallback when the promise hangs', async () => {
  const value = await withTimeout(new Promise(() => {}), 10, 'fallback');
  assert.equal(value, 'fallback');
});

test('buildSafeSearchResults keeps local results and drops invalid items', () => {
  const safe = buildSafeSearchResults([
    { videoId: 'abc123', title: 'Artist - Song', thumbnail: 'x', duration: 180 },
    { videoId: '', title: 'Bad item', thumbnail: '', duration: 0 },
    null
  ], 5);

  assert.equal(safe.length, 1);
  assert.equal(safe[0].videoId, 'abc123');
});

test('recoverable song candidate accepts valid queue objects', () => {
  assert.equal(hasRecoverableSongCandidate({ videoId: 'abc123', title: 'Song' }), true);
  assert.equal(hasRecoverableSongCandidate({ videoId: '', title: '' }), false);
});

test('normalizeSongCandidate strips invalid duration', () => {
  const normalized = normalizeSongCandidate({ videoId: 'abc123', title: 'Artist - Song', duration: 9999 });
  assert.equal(normalized.valid, true);
  assert.equal(normalized.duration, 180);
});
