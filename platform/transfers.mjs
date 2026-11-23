import { readContracts, issuanceModule } from './projections.mjs';

const tokenModule = 'splice-test-token-v1:Splice.Testing.Tokens.TestTokenV1:';
const instruction = '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferInstruction';
const cidPattern = /^[a-f0-9]{16,512}$/i;
const failure = (status, message) => Object.assign(new Error(message), { transferStatus: status });
const conflict = () => failure(409, '잔액 또는 요청 상태가 바뀌었습니다. 목록을 새로 확인해 주세요.');
const opposite = (account, party) => party === account.issuer ? account.approver : account.issuer;

// Use one committed PQS snapshot so an approval, first transfer, or acceptance
// cannot appear in both its old and new states on the same screen.
export async function portfolio(pool, party) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const active = (template, module) => readContracts(db, template, { inSnapshot: true, module });
    const pending = await active('IssuanceRequest');
    const original = await active('IssuedHolding');
    const accounts = await active('TransferAccount');
    const holdings = await active('Token', tokenModule);
    const instructions = await active('TokenTransferOffer', tokenModule);
    await db.query('COMMIT');
    const lots = new Map();
    const key = (admin, id) => JSON.stringify([admin, id]);
    for (const row of accounts) lots.set(key(row.payload.issuer, row.payload.reference),
      { ...row, first: false, balance: 0, inputs: [] });
    for (const {contract_id, payload: {holding}} of holdings) {
      const lot = lots.get(key(holding.instrumentId.admin, holding.instrumentId.id));
      if (!lot || holding.owner !== party || holding.lock) continue;
      const amount = Number(holding.amount);
      lot.inputs.push({ id: contract_id, amount });
      lot.balance += amount;
    }
    const offers = [];
    for (const {contract_id, payload: {transfer}} of instructions) {
      const lot = lots.get(key(transfer.instrumentId.admin, transfer.instrumentId.id));
      if (!lot || ![transfer.sender, transfer.receiver].includes(party) ||
          opposite(lot.payload, party) !== (transfer.sender === party ? transfer.receiver : transfer.sender)) continue;
      offers.push({ contract_id, symbol: lot.payload.symbol, reference: lot.payload.reference, sender: transfer.sender,
        receiver: transfer.receiver, amount: Number(transfer.amount) });
    }
    const issued = [...original.map(row => ({ ...row, first: true, inputs: [],
      balance: party === row.payload.issuer ? Number(row.payload.quantity) : 0 })), ...lots.values()];
    return { pending, issued, offers };
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { db.release(); }
}

export async function transferCommand(body, actor, pool, ledger) {
  const { id, operation, requestId, amount, inputs } = body ?? {};
  if (typeof id !== 'string' || !cidPattern.test(id) || typeof requestId !== 'string' ||
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(requestId))
    throw failure(400, '계약 번호와 요청 번호를 확인해 주세요.');
  const { issued, offers } = await portfolio(pool, actor.party);
  let templateId, choice, choiceArgument;
  if (operation === 'send') {
    const lot = issued.find(row => row.contract_id === id);
    if (!lot) throw conflict();
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > lot.balance)
      throw failure(422, '보낼 수량은 내 사용 가능 수량 이내의 양의 정수여야 합니다.');
    templateId = '#' + issuanceModule + (lot.first ? 'IssuedHolding' : 'TransferAccount');
    choice = lot.first ? 'FirstTransfer' : 'Send';
    choiceArgument = { amount: String(amount) };
    if (!lot.first) {
      // The browser pins the input contracts at confirmation time. A retry cannot
      // consume newly created change or another owner's holdings.
      if (!Array.isArray(inputs) || !inputs.length || new Set(inputs).size !== inputs.length) throw conflict();
      const available = new Map(lot.inputs.map(input => [input.id, input.amount]));
      if (inputs.some(cid => !available.has(cid)) ||
          inputs.reduce((sum, cid) => sum + available.get(cid), 0) < amount) throw conflict();
      Object.assign(choiceArgument, { sender: actor.party, inputs });
    }
  } else {
    const actions = { accept: 'Accept', reject: 'Reject', withdraw: 'Withdraw' };
    if (!Object.hasOwn(actions, operation)) throw failure(400, '지원하지 않는 이전 작업입니다.');
    const offer = offers.find(row => row.contract_id === id);
    if (!offer) throw conflict();
    if ((operation === 'withdraw' ? offer.sender : offer.receiver) !== actor.party) throw failure(403, '이 작업을 실행할 권한이 없습니다.');
    templateId = instruction;
    choice = 'TransferInstruction_' + actions[operation];
    choiceArgument = { extraArgs: { context: { values: {} }, meta: { values: {} } } };
  }
  try {
    const { transaction } = await ledger(actor.node_port, 'commands/submit-and-wait-for-transaction', { commands: {
      commandId: 'transfer-' + requestId, userId: 'platform-writer', actAs: [actor.party],
      commands: [{ ExerciseCommand: { templateId, contractId: id, choice, choiceArgument } }]
    } });
    return { updateId: transaction.updateId };
  } catch (error) {
    if (error.status === 409 || ['CONTRACT_NOT_FOUND','DUPLICATE_COMMAND'].includes(error.ledgerCode)) throw conflict();
    throw error;
  }
}
