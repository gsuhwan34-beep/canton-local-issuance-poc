import express from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Client, Connection, WorkflowExecutionAlreadyStartedError, WorkflowIdConflictPolicy, WorkflowIdReusePolicy } from '@temporalio/client';
import { NativeConnection, Worker } from '@temporalio/worker';
import { ledgerClient } from './ledger-api.mjs';
import { database } from './database.mjs';
import { issuanceActivities } from './issuance-activities.mjs';
import { portfolio, transferCommand } from './transfers.mjs';

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
const taskQueue = 'canton-poc-issuance';
const address = '127.0.0.1:7233';
const connection = await Connection.connect({ address });
const temporal = new Client({ connection });
const nativeConnection = await NativeConnection.connect({ address });
const worker = await Worker.create({
  connection: nativeConnection,
  taskQueue,
  workflowsPath: fileURLToPath(new URL('./issuance-workflows.cjs', import.meta.url)),
  activities: issuanceActivities({ workflowDb: workflow, projections, writeLedger })
});
const workerRun = worker.run();
workerRun.catch(error => {
  console.error('Temporal worker stopped:', error.message);
  process.exit(1);
});
const validUuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const contractIdPattern = /^[0-9a-f]{16,512}$/i;

app.disable('x-powered-by');
app.use((req, res, next) => {
  if (req.get('host') !== new URL(origin).host) return res.sendStatus(403);
  res.set('X-Frame-Options', 'DENY');
  next();
});
app.use(express.static(fileURLToPath(new URL('./dist', import.meta.url))));
app.get('/healthz', (_req, res) => res.json({ orchestration: 'temporal' }));
app.use('/api', express.json({ limit: '256kb' }));
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
  res.json({ role: actor.role, party: actor.party, ...await portfolio(db, actor.party) });
});

app.post('/api/transfers', async (req, res) => {
  const result = await transferCommand(req.body, req.actor, projections.get(req.actor.projection), writeLedger);
  res.json(result);
});

async function submit(commandId, request) {
  const requestHash = createHash('sha256').update(JSON.stringify(request)).digest('hex');
  let handle;
  try {
    handle = await temporal.workflow.start('issuanceCommand', {
      args: [{ ...request, commandId, requestHash }],
      taskQueue,
      workflowId: commandId,
      workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
      workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE_FAILED_ONLY,
      workflowRunTimeout: '3 minutes'
    });
  } catch (error) {
    if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
    handle = temporal.workflow.getHandle(commandId);
  }
  const { requestHash: recordedHash, ...result } = await handle.result();
  if (recordedHash !== requestHash) throw Object.assign(new Error('같은 요청 번호로 다른 발행 내용이 이미 기록됐습니다.'), { status: 409 });
  return { ...result, workflowId: commandId };
}

app.post('/api/issuance', async (req, res) => {
  const actor = req.actor;
  if (actor.role !== 'issuer') return res.sendStatus(403);
  const { reference, symbol, quantity } = req.body ?? {};
  if (typeof reference !== 'string' || !validUuid.test(reference) || typeof symbol !== 'string' ||
      !/^[A-Z0-9-]{1,32}$/.test(symbol) || !Number.isSafeInteger(quantity) || quantity < 1) {
    return res.status(400).json({ error: '종목 기호와 양의 정수 수량을 확인하세요.' });
  }
  const normalizedReference = reference.toLowerCase();
  const result = await submit('issue-' + normalizedReference, {
    operation: 'issue', username: actor.username, reference: normalizedReference, symbol, quantity
  });
  res.status(201).json(result);
});

app.post('/api/issuance/:cid/approve', async (req, res) => {
  const actor = req.actor;
  if (actor.role !== 'approver') return res.sendStatus(403);
  const id = req.params.cid;
  if (!contractIdPattern.test(id)) return res.sendStatus(400);
  const contractId = id.toLowerCase();
  const commandId = 'approve-' + createHash('sha256').update(contractId).digest('hex');
  const result = await submit(commandId, {
    operation: 'approve', username: actor.username, contractId
  });
  res.json(result);
});

app.use((error, req, res, next) => {
  if (error.transferStatus) return res.status(error.transferStatus).json({ error: error.message });
  console.error(req.method, req.path, error instanceof Error ? error.message : 'Unexpected error');
  const reason = error.cause?.cause?.type;
  const conflict = error.status === 409 || reason === 'IssuanceConflict';
  const status = conflict ? 409 : reason === 'IssuanceRejected' ? 422 : reason === 'IssuancePermission' ? 403 : 502;
  res.status(status).json({
    error: conflict ? '같은 요청 번호로 다른 내용이 처리됐습니다.' :
      status === 502 ? '처리 결과를 확인하지 못했습니다. 목록을 확인하고 같은 요청으로 다시 시도할 수 있습니다.' :
      '발행 명령이 거절됐습니다.'
  });
});
app.listen(18090, '127.0.0.1', () => console.log('Canton 업무 플랫폼 ' + origin));
