import { readFile } from 'node:fs/promises';
import { ledgerClient } from './ledger-api.mjs';
import { database } from './database.mjs';

const ledger = await ledgerClient('participant_admin');
const dar = await readFile(new URL('./model/.daml/dist/private-canton-issuance-1.1.0.dar', import.meta.url));
const participants = [
  { username: 'issuer-demo', role: 'issuer', port: 5013, partyName: 'IssuingDesk', projection: 'pqs_issuer' },
  { username: 'approver-demo', role: 'approver', port: 5023, partyName: 'BrokerB', projection: 'pqs_broker' }
];
const db = await database('poc_workflow');
try {
  await db.query(`CREATE TABLE IF NOT EXISTS app_actor (
    username text PRIMARY KEY, role text UNIQUE NOT NULL CHECK (role IN ('issuer','approver')),
    node_port integer NOT NULL, party text NOT NULL, projection text NOT NULL
  )`);
  for (const actor of participants) {
    const { partyDetails } = await ledger(actor.port, 'parties');
    const party = partyDetails.find(row => row.party.startsWith(actor.partyName + '::') && row.isLocal);
    if (!party) throw new Error('Local party missing: ' + actor.partyName);
    await ledger(actor.port, 'packages?vetAllPackages=true', dar);
    const existing = await ledger(actor.port, 'users');
    const rights = [{ kind: { CanActAs: { value: { party: party.party } } } }];
    if (!existing.users.some(u => u.id === 'platform-writer')) {
      await ledger(actor.port, 'users', { user: { id: 'platform-writer', primaryParty: party.party }, rights });
    } else {
      const current = await ledger(actor.port, 'users/platform-writer/rights');
      if (current.rights.length !== 1 || current.rights[0].kind.CanActAs?.value.party !== party.party) {
        throw new Error('Platform writer rights differ from expected configuration on ' + actor.port);
      }
    }
    await db.query(`INSERT INTO app_actor(username, role, node_port, party, projection)
      VALUES ($1,$2,$3,$4,$5) ON CONFLICT (username) DO UPDATE
      SET role=EXCLUDED.role,node_port=EXCLUDED.node_port,party=EXCLUDED.party,projection=EXCLUDED.projection`,
      [actor.username, actor.role, actor.port, party.party, actor.projection]);
  }
} finally { await db.end(); }
