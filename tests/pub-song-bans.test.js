const test = require('node:test');
const assert = require('node:assert/strict');

const {
  filterAvailableSongs,
  getBannedSongEntries,
  isSongBanned,
  isValidVideoId,
  normalizeBannedSongs,
  setSongBan
} = require('../pub-song-bans');

test('pub ban list accepts exact YouTube video IDs only', () => {
  assert.equal(isValidVideoId('dQw4w9WgXcQ'), true);
  assert.equal(isValidVideoId('bad-id'), false);
  assert.equal(isValidVideoId('dQw4w9WgXcQ&x'), false);
});

test('bans affect only the pub-local list and filter matching songs', () => {
  const pub = { bannedSongs: {} };
  const songs = [
    { videoId: 'dQw4w9WgXcQ', title: 'Blocked here' },
    { videoId: 'aaaaaaaaaaa', title: 'Available' }
  ];

  assert.equal(setSongBan(pub, 'dQw4w9WgXcQ', 'Blocked here', true), true);
  assert.equal(isSongBanned(pub, 'dQw4w9WgXcQ'), true);
  assert.deepEqual(filterAvailableSongs(pub, songs), [songs[1]]);
  assert.deepEqual(getBannedSongEntries(pub), [{ videoId: 'dQw4w9WgXcQ', title: 'Blocked here' }]);

  const otherPub = { bannedSongs: {} };
  assert.equal(isSongBanned(otherPub, 'dQw4w9WgXcQ'), false);
});

test('a ban can be removed and malformed stored entries are ignored', () => {
  const pub = { bannedSongs: { invalid: { title: 'Ignore' } } };
  assert.deepEqual(normalizeBannedSongs(pub.bannedSongs), {});
  assert.equal(setSongBan(pub, 'dQw4w9WgXcQ', 'Blocked here', true), true);
  assert.equal(setSongBan(pub, 'dQw4w9WgXcQ', '', false), true);
  assert.equal(isSongBanned(pub, 'dQw4w9WgXcQ'), false);
});