import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { ledgerClient } from './ledger-api.mjs';

async function readJson(port, path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    redirect: 'error', signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return response.json();
}

async function checkNetwork() {
  const admin = await ledgerClient('participant_admin');
  const nodes = await Promise.all([[5013, 'IssuingDesk'], [5023, 'BrokerB']].map(async ([port, name]) => {
    const [{ participantId }, { partyDetails }, { version }] = await Promise.all([
      admin(port, 'parties/participant-id'), admin(port, 'parties'), readJson(port, '/v2/version')
    ]);
    assert.ok(participantId && version === '3.7.3', 'Unexpected participant or Canton version on ' + port);
    const local = partyDetails.filter(p => p.isLocal && p.party.startsWith(name + '::'));
    assert.equal(local.length, 1, 'Expected a local ' + name + ' party on ' + port);
    const party = local[0].party;
    const { connectedSynchronizers } = await admin(port, 'state/connected-synchronizers?partyId=' + encodeURIComponent(party));
    assert.equal(connectedSynchronizers.length, 1, 'Expected one dedicated synchronizer on ' + port);
    const [sync] = connectedSynchronizers;
    assert.ok(sync.synchronizerAlias === 'da' && sync.synchronizerId, 'Missing local synchronizer on ' + port);
    for (const [user, right] of [['lens-viewer', 'CanReadAs'], ['platform-writer', 'CanActAs']]) {
      const { rights } = await admin(port, 'users/' + user + '/rights');
      assert.ok(rights.length === 1 && rights[0].kind[right]?.value.party === party,
        `Unexpected ${user} rights on ${port}`);
    }
    return { participantId, sync: sync.synchronizerId, name };
  }));
  assert.notEqual(nodes[0].participantId, nodes[1].participantId, 'Both APIs point to the same participant');
  assert.equal(nodes[0].sync, nodes[1].sync, 'Participants are on different synchronizers');
  return nodes.map(node => node.name + '@' + node.participantId.split('::')[0]).join(' + ') + ' -> ' + nodes[0].sync;
}

async function checkWorker() {
  const { Connection } = await import('@temporalio/client');
  const connection = await Connection.connect({ address: '127.0.0.1:7233', connectTimeout: '5s' });
  try {
    for (let attempt = 0; attempt < 10; attempt++) {
      // Temporal records a poller when the issuance worker requests workflow tasks.
      const result = await connection.withDeadline(Date.now() + 4000, () =>
        connection.workflowService.describeTaskQueue({
          namespace: 'default', taskQueue: { name: 'canton-poc-issuance' }, taskQueueType: 1
        }));
      if (result.pollers?.length) return 'issuance task queue has a registered workflow poller';
      await delay(500);
    }
    throw new Error('No poller on canton-poc-issuance');
  } finally { await connection.close(); }
}

const checks = [
  ['Canton topology and party rights', checkNetwork],
  ['Temporal', checkWorker],
  ['Keycloak', async () => {
    const { issuer } = await readJson(18084, '/realms/canton-poc/.well-known/openid-configuration');
    assert.equal(issuer, 'http://127.0.0.1:18084/realms/canton-poc');
  }],
  ['Issuance app', async () => assert.equal((await readJson(18090, '/healthz')).orchestration, 'temporal')],
  ...[18081, 18082].map(port => ['PQS ' + port, async () => {
    const health = await readJson(port, '/readyz');
    assert.ok(health.grpc_up && health.jdbc_connection_pool_up && health.stream_up, 'Ledger stream or database unavailable');
  }]),
  ...[5173, 5174].map(port => ['DSRV Lens ' + port, async () => {
    const result = await readJson(port, '/api/contracts');
    assert.ok(Array.isArray(result.rows), 'No contract query result');
    return result.rows.length + ' rows on the returned page';
  }])
];

const results = await Promise.allSettled(checks.map(([, check]) => check()));
for (const [index, result] of results.entries()) {
  const name = checks[index][0];
  if (result.status === 'fulfilled') console.log('OK   ', name, result.value ?? '');
  else {
    const error = result.reason;
    console.error('FAIL ', name, error.cause?.code ?? error.message);
    process.exitCode = 1;
  }
}
