import React, { useState } from 'react';
import Modal from './upstream/Modal';
import { generateCommandId } from './upstream/commandId';

export function chooseInputs(holdings, amount) {
  const ids = [];
  let total = 0;
  for (const input of [...holdings].sort((a, b) => b.amount - a.amount)) {
    if (total >= amount) break;
    ids.push(input.id);
    total += input.amount;
  }
  return ids;
}

const names = {
  fund: '모의 대금 제공', acceptFunding: '모의 대금 수령', offerSale: 'DvP 매도 제안',
  settle: '동시결제', withdrawSale: '매도 제안 회수', rejectSale: '매도 제안 거절'
};
const partyName = party => party.split('::')[0];

export default function Settlement({ data, busy, error, submit }) {
  const [target, setTarget] = useState(null);
  const [amount, setAmount] = useState('');
  const [payment, setPayment] = useState('');
  const { dvp, party, role, issued } = data;
  const issuer = role === 'issuer';
  const eligible = issued.filter(row => row.payload.issuer === party && row.balance > 0);
  const [selected, setSelected] = useState('');
  const lot = eligible.find(row => row.contract_id === selected) ?? eligible[0];

  function open(operation, row) {
    setAmount('');
    setPayment('');
    setTarget({ operation, row, requestId: generateCommandId() });
  }

  async function confirm() {
    const { operation, row, requestId } = target;
    const payload = target.payload ?? { operation, requestId, id: row?.contract_id };
    if (!target.payload) {
      if (operation === 'fund' || operation === 'offerSale') payload.amount = Number(amount);
      if (operation === 'offerSale') {
        payload.payment = Number(payment);
        payload.inputs = chooseInputs(row.inputs, payload.amount);
      }
      if (operation === 'settle') {
        const { sale } = row.payload;
        payload.inputs = chooseInputs(dvp.cashInputs.filter(input => input.admin === sale.seller), Number(sale.payment));
      }
      setTarget({ ...target, payload, attempted: true });
    }
    const outcome = await submit('dvp', payload);
    if (outcome === 'confirmed') setTarget(null);
    else if (outcome === 'rejected') setTarget(current => ({ ...current, payload: undefined, requestId: generateCommandId() }));
  }

  const operation = target?.operation;
  const offer = target?.row?.payload?.sale;
  const positive = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
  const invalid = ((operation === 'fund' || operation === 'offerSale') && !positive(amount)) ||
    (operation === 'offerSale' && (!positive(payment) || Number(amount) > target.row.balance));

  return <section className="panel" aria-labelledby="dvp-heading">
    <h2 className="h5" id="dvp-heading">증권·대금 동시결제 (DvP)</h2>
    <p>같은 Canton 사설망에서 증권과 모의 대금(DEMO-CASH)을 한 거래로 교환합니다.</p>
    <div className="d-flex flex-wrap gap-3 align-items-end pb-3">
      <strong data-testid="cash-balance">내 모의 대금 {dvp.cashBalance}개</strong>
      {issuer && <>
        <button disabled={busy} className="btn btn-outline-primary btn-sm" onClick={() => open('fund')}>{names.fund}</button>
        {lot && <div className="d-flex gap-2 align-items-end">
          <label>매도할 종목
            <select className="form-select form-select-sm" value={lot.contract_id} onChange={e => setSelected(e.target.value)}>
              {eligible.map(row => <option key={row.contract_id} value={row.contract_id}>
                {row.payload.symbol} · {row.payload.reference.slice(0, 8)} · {row.balance}개
              </option>)}
            </select>
          </label>
          <button disabled={busy} className="btn btn-primary btn-sm" onClick={() => open('offerSale', lot)}>{names.offerSale}</button>
        </div>}
      </>}
    </div>
    {dvp.funding.length > 0 && <ul className="list-group mb-3">
      {dvp.funding.map(row => <li key={row.contract_id} className="list-group-item d-flex justify-content-between align-items-center">
        <span>{partyName(row.payload.buyer)}에게 모의 대금 {row.payload.quantity}개 제공</span>
        {party === row.payload.buyer
          ? <button disabled={busy} className="btn btn-outline-primary btn-sm" onClick={() => open('acceptFunding', row)}>{names.acceptFunding}</button>
          : <span className="text-secondary">수령 대기</span>}
      </li>)}
    </ul>}
    <h3 className="h6">결제 대기</h3>
    {!dvp.sales.length ? <p className="text-secondary">결제 대기 중인 제안이 없습니다.</p> :
      <div className="table-responsive"><table className="table align-middle">
        <thead><tr><th>종목</th><th>증권 수량</th><th>모의 대금</th><th>매도자 → 매수자</th><th>결제 기한</th><th>작업</th></tr></thead>
        <tbody>{dvp.sales.map(row => {
          const { sale, settlement } = row.payload;
          return <tr key={row.contract_id}>
            <td>{sale.symbol} <small className="text-secondary">{sale.reference.slice(0, 8)}</small></td>
            <td>{sale.quantity}개</td><td>{sale.payment}개</td><td>{partyName(sale.seller)} → {partyName(sale.buyer)}</td>
            <td>{new Date(settlement.allocateBefore).toLocaleString('ko-KR')}</td>
            <td><div className="d-flex gap-2">
              {(party === sale.buyer ? ['settle', 'rejectSale'] : ['withdrawSale']).map(next =>
                <button key={next} disabled={busy} className="btn btn-outline-primary btn-sm" onClick={() => open(next, row)}>{names[next]}</button>)}
            </div></td>
          </tr>;
        })}</tbody>
      </table></div>}
    <h3 className="h6">결제 완료</h3>
    {!dvp.settlements.length ? <p className="text-secondary mb-0">완료된 동시결제가 없습니다.</p> :
      <ul className="mb-0">{dvp.settlements.map(row => <li key={row.contract_id}>
        {row.payload.sale.symbol} 증권 {row.payload.sale.quantity}개와 모의 대금 {row.payload.sale.payment}개 교환
      </li>)}</ul>}
    <Modal show={!!target} title={names[operation]} onClose={() => !busy && setTarget(null)}
      onConfirm={confirm} confirmButtonLabel={names[operation] + ' 확정'} confirmButtonDisabled={busy || invalid}>
      {(operation === 'fund' || operation === 'offerSale') && <label className="d-block">
        {operation === 'fund' ? '제공할 모의 대금' : '매도 수량'}
        <input className="form-control" type="number" min="1" step="1" value={amount}
          disabled={!!target.payload} onChange={e => setAmount(e.target.value)} />
      </label>}
      {operation === 'offerSale' && <>
        <label className="d-block mt-2">받을 모의 대금 (총액)
          <input className="form-control" type="number" min="1" step="1" value={payment}
            disabled={!!target.payload} onChange={e => setPayment(e.target.value)} />
        </label>
        <p className="mt-2 mb-0">{target.row.payload.symbol}의 매도 수량은 결제 전까지 예약됩니다.</p>
      </>}
      {operation === 'acceptFunding' && <p>모의 대금 {target.row.payload.quantity}개를 수령합니다.</p>}
      {operation === 'settle' && <>
        <p><strong>{offer.symbol} {offer.quantity}개</strong>를 받고 <strong>모의 대금 {offer.payment}개</strong>를 지급합니다.</p>
        <p className="mb-0">두 이전이 같은 원장 거래에서 확정됩니다.</p>
      </>}
      {(operation === 'rejectSale' || operation === 'withdrawSale') && <p>예약된 증권이 매도자의 사용 가능 잔고로 돌아갑니다.</p>}
      {error && target?.attempted && <p className="text-danger mt-2 mb-0">{error}</p>}
    </Modal>
  </section>;
}
