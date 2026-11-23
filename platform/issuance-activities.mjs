import { ApplicationFailure } from '@temporalio/common';
import { issuanceModule, readContracts } from './projections.mjs';

export function issuanceActivities({ workflowDb, projections, writeLedger }) {
  async function submitIssuanceCommand(request) {
    const { rows } = await workflowDb.query('SELECT * FROM app_actor ORDER BY role');
    const issuer = rows.find(row => row.role === 'issuer');
    const approver = rows.find(row => row.role === 'approver');
    const isIssue = request.operation === 'issue';
    const actor = isIssue ? issuer : approver;
    if (!issuer || !approver || actor.username !== request.username) {
      throw ApplicationFailure.nonRetryable('발행 업무 권한을 확인할 수 없습니다.', 'IssuancePermission');
    }
    const pqs = projections.get(actor.projection);
    const output = isIssue ? 'IssuanceRequest' : 'IssuedHolding';
    let { reference } = request;
    if (!isIssue) {
      const [pending] = await readContracts(pqs, 'IssuanceRequest', { history: true, contractId: request.contractId });
      if (!pending) throw new Error('승인 대상이 조회 DB에 아직 반영되지 않았습니다.');
      ({ reference } = pending.payload);
      if (pending.payload.approver !== approver.party) {
        throw ApplicationFailure.nonRetryable('해당 발행 요청을 승인할 권한이 없습니다.', 'IssuancePermission');
      }
    }

    const [existing] = await readContracts(pqs, output, { history: true, reference });
    if (existing) {
      if (isIssue && (existing.payload.symbol !== request.symbol ||
          String(existing.payload.quantity) !== String(request.quantity) ||
          existing.payload.issuer !== issuer.party || existing.payload.approver !== approver.party)) {
        throw ApplicationFailure.nonRetryable('같은 요청 번호로 다른 발행 내용이 이미 기록됐습니다.', 'IssuanceConflict');
      }
      return { contractId: existing.contract_id, updateId: existing.event.update_id ?? existing.event.transaction_id ?? null };
    }

    const templateId = '#' + issuanceModule + 'IssuanceRequest';
    const command = isIssue
      ? { CreateCommand: {
          templateId,
          createArguments: { issuer: issuer.party, approver: approver.party, reference, symbol: request.symbol, quantity: String(request.quantity) }
        } }
      : { ExerciseCommand: { templateId, contractId: request.contractId, choice: 'Approve', choiceArgument: {} } };
    let transaction;
    try {
      ({ transaction } = await writeLedger(actor.node_port, 'commands/submit-and-wait-for-transaction', {
        commands: { commandId: request.commandId, userId: 'platform-writer', actAs: [actor.party], commands: [command] }
      }));
    } catch (error) {
      // After an ambiguous result, retry with the same command ID and check
      // PQS history before submitting again.
      if (error.status >= 400 && error.status < 500 &&
          ![408, 409, 429].includes(error.status) &&
          !['DUPLICATE_COMMAND', 'CONTRACT_NOT_FOUND'].includes(error.ledgerCode)) {
        throw ApplicationFailure.nonRetryable('원장이 발행 명령을 거절했습니다.', 'IssuanceRejected');
      }
      throw error;
    }
    const created = transaction.events
      .map(event => event.CreatedEvent?.value ?? event.CreatedEvent)
      .find(event => event?.templateId?.endsWith(':' + output));
    if (!created?.contractId) throw new Error('원장의 생성 계약을 응답에서 확인하지 못했습니다.');
    return { updateId: transaction.updateId, contractId: created.contractId };
  }

  async function confirmProjections(request, contractId) {
    const template = request.operation === 'issue' ? 'IssuanceRequest' : 'IssuedHolding';
    const results = await Promise.all([...projections.values()].map(db =>
      readContracts(db, template, { history: true, contractId })
    ));
    if (results.some(rows => rows.length !== 1)) throw new Error('기관별 PQS 반영 대기 중입니다.');
  }

  return { submitIssuanceCommand, confirmProjections };
}
