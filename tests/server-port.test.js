const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');

const { findAvailablePort } = require('../staff-server');

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
