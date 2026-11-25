import { issuanceModule } from './projections.mjs';
import {
  conflict, failure, inputTotal, portfolio, settlementModule, submitLedger, validContractId, validRequestId
} from './transfers.mjs';

const positive = value => Number.isSafeInteger(value) && value > 0;
const exercise = (module, name, contractId, choice, choiceArgument = {}) => ({
  ExerciseCommand: { templateId: '#' + module + name, contractId, choice, choiceArgument }
});

export async function settlementCommand(body, actor, pool, ledger, actorDb) {
  const { operation, id, requestId, amount, payment, inputs } = body ?? {};
  if (!validRequestId(requestId) || (operation !== 'fund' && !validContractId(id))) {
    throw failure(400, '계약 번호와 요청 번호를 확인해 주세요.');
  }
  const commandId = 'dvp-' + requestId;
  if (operation === 'fund') {
    if (actor.role !== 'issuer') throw failure(403, '발행기관에서 모의 대금을 제공할 수 있습니다.');
    if (!positive(amount)) throw failure(422, '모의 대금 수량은 양의 정수로 입력해 주세요.');
    const { rows: [buyer] } = await actorDb.query("SELECT party FROM app_actor WHERE role = 'approver'");
    return submitLedger(ledger, actor, commandId, { CreateCommand: {
      templateId: '#' + settlementModule + 'CashFunding',
      createArguments: { issuer: actor.party, buyer: buyer.party, quantity: String(amount) }
    } });
  }

  const { issued, dvp } = await portfolio(pool, actor.party);
  let command;
  if (operation === 'acceptFunding') {
    const funding = dvp.funding.find(row => row.contract_id === id);
    if (!funding) throw conflict();
    if (actor.party !== funding.payload.buyer) throw failure(403, '받는 기관에서 모의 대금을 수령해 주세요.');
    command = exercise(settlementModule, 'CashFunding', id, 'AcceptFunding');
  } else if (operation === 'offerSale') {
    const lot = issued.find(row => row.contract_id === id);
    if (!lot) throw conflict();
    if (lot.payload.issuer !== actor.party) throw failure(403, '발행기관에서 매도를 제안할 수 있습니다.');
    if (!positive(amount) || !positive(payment)) throw failure(422, '증권 수량과 모의 대금은 양의 정수로 입력해 주세요.');
    if (amount > lot.balance || (!lot.first && inputTotal(inputs, lot.inputs) < amount)) throw conflict();
    const params = { saleId: requestId, amount: String(amount), payment: String(payment) };
    command = lot.first
      ? exercise(issuanceModule, 'IssuedHolding', id, 'FirstSale', params)
      : exercise(issuanceModule, 'TransferAccount', id, 'OfferSale', { ...params, inputs });
  } else {
    const choices = { settle: 'Settle', rejectSale: 'RejectSale', withdrawSale: 'WithdrawSale' };
    if (!Object.hasOwn(choices, operation)) throw failure(400, '지원하지 않는 결제 작업입니다.');
    const offer = dvp.sales.find(row => row.contract_id === id);
    if (!offer) throw conflict();
    const { sale } = offer.payload;
    if (actor.party !== (operation === 'withdrawSale' ? sale.seller : sale.buyer)) {
      throw failure(403, '이 작업을 실행할 권한이 없습니다.');
    }
    let params = {};
    if (operation === 'settle') {
      // Always send a well-formed attempt to Canton, including with insufficient
      // funds. The ledger enforces the invariant and keeps both legs unchanged.
      inputTotal(inputs, dvp.cashInputs.filter(input => input.admin === sale.seller));
      params = { cashInputs: inputs };
    }
    command = exercise(settlementModule, 'DvPOffer', id, choices[operation], params);
  }
  try {
    return await submitLedger(ledger, actor, commandId, command);
  } catch (error) {
    if (operation === 'settle' && [400, 422].includes(error.status) && !error.transferStatus) {
      const offer = dvp.sales.find(row => row.contract_id === id);
      const { sale } = offer.payload;
      const provided = inputTotal(inputs, dvp.cashInputs.filter(input => input.admin === sale.seller));
      if (provided < Number(sale.payment)) {
        throw failure(422, '모의 대금이 부족해 원장에서 결제가 거절됐습니다. 증권과 대금의 소유자는 그대로입니다.');
      }
      throw failure(422, '원장에서 결제가 거절됐습니다. 제안 기한과 잔액을 확인해 주세요.');
    }
    throw error;
  }
}
