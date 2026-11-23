import express from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { ledgerClient } from './ledger-api.mjs';
import { database } from './database.mjs';

const app = express();
const origin = 'http://127.0.0.1:18090';
const issuer = 'http://127.0.0.1:18084/realms/canton-poc';
const audience = 'canton-platform';
const jwks = createRemoteJWKSet(new URL(issuer + '/protocol/openid-connect/certs'));
const workflow = await database('poc_workflow');
const projections = new Map([
  ['pqs_issuer', await database('pqs_issuer')],
  ['pqs_broker', await database('pqs_broker')]
]);
const writeLedger = await ledgerClient('platform-writer');
const moduleId = 'private-canton-issuance:Issuance:';
const validUuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const contractIdPattern = /^[0-9a-f]{16,512}$/i;

app.disable('x-powered-by');
app.use((req, res, next) => {
  if (req.get('host') !== new URL(origin).host) return res.sendStatus(403);
  res.set('X-Frame-Options', 'DENY');
  next();
});
app.use(express.static(fileURLToPath(new URL('./dist', import.meta.url))));
app.use('/api', express.json({ limit: '8kb' }));
app.use('/api', async (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (req.method === 'POST' && req.get('origin') !== origin) return res.sendStatus(403);
  const authorization = req.get('authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) return res.sendStatus(401);
  let claims;
  try {
    ({ payload: claims } = await jwtVerify(authorization.slice(7), jwks, { issuer, audience, algorithms: ['RS256'] }));
  } catch { return res.sendStatus(401); }
  const { rows: [actor] } = await workflow.query('SELECT * FROM app_actor WHERE username=$1', [claims.preferred_username]);
  if (!actor || claims.azp !== audience) return res.sendStatus(403);
  req.actor = actor;
  next();
});

app.get('/api/contracts', async (req, res) => {
  const actor = req.actor;
  const db = projections.get(actor.projection);
  async function active(name) {
    const identifier = moduleId + name;
    try {
      return (await db.query('SELECT contract_id, payload FROM active($1::text)', [identifier])).rows;
    } catch (error) {
      // PQS learns new template identifiers as it ingests their first ledger events.
      if (error.code === 'P0001' && error.message === 'Identifier not found: ' + identifier) return [];
      throw error;
    }
  }
  const [pending, issued] = await Promise.all(['IssuanceRequest', 'IssuedHolding'].map(active));
  res.json({ role: actor.role, party: actor.party, pending, issued });
});

async function submit(actor, commandId, command) {
  const result = await writeLedger(actor.node_port, 'commands/submit-and-wait-for-transaction', {
    commands: { commandId, userId: 'platform-writer', actAs: [actor.party], commands: [command] }
  });
  const created = result.transaction.events
    .map(event => event.CreatedEvent?.value ?? event.CreatedEvent).filter(Boolean);
  return { updateId: result.transaction.updateId, contractId: created[0]?.contractId };
}

app.post('/api/issuance', async (req, res) => {
  const actor = req.actor;
  if (actor.role !== 'issuer') return res.sendStatus(403);
  const { reference, symbol, quantity } = req.body ?? {};
  if (typeof reference !== 'string' || !validUuid.test(reference) || typeof symbol !== 'string' ||
      !/^[A-Z0-9-]{1,32}$/.test(symbol) || !Number.isSafeInteger(quantity) || quantity < 1) {
    return res.status(400).json({ error: '종목 기호와 양의 정수 수량을 확인하세요.' });
  }
  const { rows: [approver] } = await workflow.query("SELECT party FROM app_actor WHERE role='approver'");
  const result = await submit(actor, 'issue-' + reference, {
    CreateCommand: {
      templateId: '#' + moduleId + 'IssuanceRequest',
      createArguments: { issuer: actor.party, approver: approver.party, reference, symbol, quantity: String(quantity) }
    }
  });
  res.status(201).json(result);
});

app.post('/api/issuance/:cid/approve', async (req, res) => {
  const actor = req.actor;
  if (actor.role !== 'approver') return res.sendStatus(403);
  const id = req.params.cid;
  if (!contractIdPattern.test(id)) return res.sendStatus(400);
  const commandId = 'approve-' + createHash('sha256').update(id).digest('hex');
  const result = await submit(actor, commandId, {
    ExerciseCommand: { templateId: '#' + moduleId + 'IssuanceRequest', contractId: id, choice: 'Approve', choiceArgument: {} }
  });
  res.json(result);
});

app.use((error, req, res, next) => {
  console.error(req.method, req.path, error instanceof Error ? error.message : 'Unexpected error');
  const conflict = error.ledgerCode === 'DUPLICATE_COMMAND' || error.ledgerCode === 'CONTRACT_NOT_FOUND';
  res.status(conflict ? 409 : 502).json({
    error: conflict ? '이미 처리된 요청입니다. 목록을 다시 조회하세요.' : '원장 또는 조회 DB에서 응답을 받지 못했습니다.'
  });
});
app.listen(18090, '127.0.0.1', () => console.log('Canton 업무 플랫폼 ' + origin));
