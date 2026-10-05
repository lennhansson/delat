const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');

const { findAvailablePort, getGuestPubs, isRegisteredPub } = require('../staff-server');

test('pub registry allows configured pub IDs and exposes only guest-visible pubs', () => {
  assert.equal(isRegisteredPub('7-an'), true);
  assert.equal(isRegisteredPub('demo'), true);
  assert.equal(isRegisteredPub('not-configured'), false);
  assert.deepEqual(getGuestPubs(), [{ id: '7-an', name: '7-AN' }]);
});

test('findAvailablePort skips a busy port and returns a free one', async () => {
  const busyServer = net.createServer();

  try {
    await new Promise((resolve) => busyServer.listen(0, resolve));
    const busyPort = busyServer.address().port;

    const nextPort = await findAvailablePort(busyPort);

    assert.notStrictEqual(nextPort, busyPort);
    assert.ok(typeof nextPort === 'number' && Number.isInteger(nextPort));
  } finally {
    await new Promise((resolve) => busyServer.close(resolve));
  }
});
