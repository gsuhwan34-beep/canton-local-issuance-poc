import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Keycloak from 'keycloak-js';
import 'bootstrap/dist/css/bootstrap.min.css';
import Modal from './upstream/Modal';
import { generateCommandId } from './upstream/commandId';
import './style.css';

const auth = new Keycloak({ url: 'http://127.0.0.1:18084', realm: 'canton-poc', clientId: 'canton-platform' });
const connected = auth.init({ onLoad: 'login-required', pkceMethod: 'S256', checkLoginIframe: false });

async function api(path, body) {
  await connected;
  await auth.updateToken(20);
  const response = await fetch('/api/' + path, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: 'Bearer ' + auth.token, 'content-type': 'application/json' },
    body: body && JSON.stringify(body)
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(Error(json.error || '요청이 거절되었습니다 (' + response.status + ')'), { status: response.status });
  return json;
}

function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [updateId, setUpdateId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState(null);
  const [transfer, setTransfer] = useState(null);
  const [amountText, setAmountText] = useState('');
  const [reference, setReference] = useState(generateCommandId);
  const update = () => api('contracts').then(setData).catch(e => setError(e.message));
  useEffect(() => {
    update();
    const interval = setInterval(update, 3500);
    return () => clearInterval(interval);
  }, []);

  async function submit(path, payload) {
    setBusy(true); setError(''); setInfo(''); setUpdateId(null);
    try {
      const result = await api(path, payload);
      const state = result.projectionStatus === 'confirmed' ? '기관별 조회 DB 반영 확인' : '기관별 조회 DB 반영 대기';
      setInfo(path === 'transfers' ? '이전 작업이 원장에 기록됐습니다.' : '원장 확정 · ' + state + ' · ' + result.workflowId);
      setUpdateId(result.updateId);
      setTarget(null);
      setTransfer(null);
      if (path === 'issuance') setReference(generateCommandId());
      await update();
    } catch (e) {
      setError(e.message);
      if (path === 'transfers' && e.status >= 400 && e.status < 500) setTransfer(null);
      await update();
    }
    finally { setBusy(false); }
  }

  const actions = { send: '보내기', accept: '수락', reject: '거절', withdraw: '회수' };
  function openTransfer(row, operation) {
    setError(''); setInfo(''); setAmountText('');
    setTransfer({ row, operation, requestId: generateCommandId() });
  }
  function confirmTransfer() {
    if (transfer.submission) return submit('transfers', transfer.submission);
    const { row, operation, requestId } = transfer;
    const amount = Number(amountText);
    const inputs = [];
    if (operation === 'send' && !row.first) {
      let total = 0;
      for (const input of [...row.inputs].sort((a, b) => b.amount - a.amount)) {
        inputs.push(input.id); total += input.amount;
        if (total >= amount) break;
      }
    }
    const submission = { id: row.contract_id, operation, requestId, ...(operation === 'send' && { amount, inputs }) };
    setTransfer({ ...transfer, submission });
    submit('transfers', submission);
  }
  const peer = data?.role === 'issuer' ? 'BrokerB' : 'IssuingDesk';
  const lens = 'http://127.0.0.1:' + (data?.role === 'issuer' ? '5173' : '5174');
  const invalidAmount = !Number.isSafeInteger(Number(amountText)) || Number(amountText) < 1 || Number(amountText) > transfer?.row.balance;

  return <main className="container py-5">
    <header className="d-flex flex-wrap justify-content-between align-items-start gap-3 pb-4 border-bottom">
      <div><div className="text-uppercase text-secondary small">Canton 사설망</div>
        <h1 className="display-5 fw-semibold">증권 발행·이전 실증</h1>
        {data && <p className="text-secondary mb-0">{data.role === 'issuer' ? '발행기관 · IssuingDesk' : '승인기관 · BrokerB'}</p>}
      </div>
      <div className="d-flex gap-2">
        {data && <a className="btn btn-outline-primary" href={lens + '/#/transactions'} target="_blank" rel="noreferrer">내 원장 기록</a>}
        <a className="btn btn-outline-primary" href="http://127.0.0.1:8233/" target="_blank" rel="noreferrer">워크플로 이력</a>
        <button className="btn btn-outline-secondary" onClick={() => auth.logout({ redirectUri: location.origin })}>로그아웃</button>
      </div>
    </header>
    {error && <p role="alert" className="alert alert-danger mt-3">{error}</p>}
    {info && <p role="status" className="alert alert-success mt-3 text-break">{info}
      {updateId && <> <a href={lens + '/#/tx/' + encodeURIComponent(updateId)} target="_blank" rel="noreferrer">Lens에서 이 거래 열기</a></>}</p>}
    {data?.role === 'issuer' && <section className="panel">
      <h2 className="h5">새 발행 요청</h2>
      <form className="row g-3 align-items-end" onSubmit={e => {
        e.preventDefault();
        const input = new FormData(e.currentTarget);
        submit('issuance', { reference, symbol: input.get('symbol'), quantity: Number(input.get('quantity')) });
      }}>
        <label className="col-md-5">종목 기호<input name="symbol" className="form-control" required pattern="[A-Z0-9-]{1,32}" defaultValue="POC-BOND" /></label>
        <label className="col-md-4">수량<input name="quantity" className="form-control" required type="number" min="1" step="1" defaultValue="100" /></label>
        <div className="col-md-3"><button className="btn btn-primary w-100" disabled={busy}>요청 등록</button></div>
      </form>
    </section>}
    {data && [['승인 대기', data.pending], ['발행 완료', data.issued]].map(([title, rows], index) =>
      <section className="panel" key={title}>
        <h2 className="h5">{title} <span className="text-secondary fw-normal">{rows.length}건</span></h2>
        {rows.length === 0 ? <p className="text-secondary mb-0">표시할 계약이 없습니다.</p> :
          <div className="table-responsive"><table className="table align-middle mb-0">
            <thead><tr><th>종목</th><th>{index === 0 ? '요청 수량' : '총 발행량'}</th>{index === 1 && <th>내 사용 가능 수량</th>}<th>{index === 0 ? '계약 ID' : '발행 번호'}</th><th aria-label="작업"></th></tr></thead>
            <tbody>{rows.map(row => <tr key={row.contract_id}>
              <td>{row.payload.symbol}</td><td>{row.payload.quantity}</td>
              {index === 1 && <td>{row.balance}</td>}
              <td><code title={index === 0 ? row.contract_id : row.payload.reference}>{(index === 0 ? row.contract_id : row.payload.reference).slice(0, 12)}…</code></td>
              <td>{index === 0 && data.role === 'approver' && <button disabled={busy} className="btn btn-primary btn-sm" onClick={() => setTarget(row)}>승인</button>}
                {index === 1 && row.balance > 0 && <button disabled={busy} className="btn btn-outline-primary btn-sm" onClick={() => openTransfer(row, 'send')}>보내기</button>}</td>
            </tr>)}</tbody>
          </table></div>}
      </section>)}
    {data && <section className="panel">
      <h2 className="h5">이전 수락 대기 <span className="text-secondary fw-normal">{data.offers.length}건</span></h2>
      {data.offers.length === 0 ? <p className="text-secondary mb-0">대기 중인 이전 요청이 없습니다.</p> :
        <div className="table-responsive"><table className="table align-middle mb-0">
          <thead><tr><th>종목</th><th>수량</th><th>보낸 곳 → 받을 곳</th><th>발행 번호</th><th>작업</th></tr></thead>
          <tbody>{data.offers.map(row => <tr key={row.contract_id}>
            <td>{row.symbol}</td><td>{row.amount}</td>
            <td>{row.sender.split('::')[0]} → {row.receiver.split('::')[0]}</td>
            <td><code title={row.reference}>{row.reference.slice(0, 12)}…</code></td>
            <td className="d-flex gap-2">{(row.receiver === data.party ? ['accept', 'reject'] : ['withdraw']).map(operation =>
              <button key={operation} disabled={busy} className="btn btn-outline-primary btn-sm" onClick={() => openTransfer(row, operation)}>{actions[operation]}</button>)}</td>
          </tr>)}</tbody></table></div>}
    </section>}
    <Modal show={!!transfer} title={actions[transfer?.operation]} onClose={() => !busy && setTransfer(null)} onConfirm={confirmTransfer}
      confirmButtonLabel={actions[transfer?.operation] + ' 확정'} confirmButtonDisabled={busy || (transfer?.operation === 'send' && invalidAmount)}>
      {transfer?.operation === 'send' ? <>
        <p><strong>{transfer.row.payload.symbol}</strong>을 {peer}에 보냅니다. 상대 기관이 수락하면 이전이 완료됩니다.</p>
        <label>보낼 수량 <span className="text-secondary">(사용 가능 {transfer.row.balance}개)</span>
          <input className="form-control" type="number" min="1" max={transfer.row.balance} step="1" value={amountText} disabled={!!transfer.submission} autoFocus onChange={e => setAmountText(e.target.value)} /></label>
      </> : transfer && <p>{transfer.row.symbol} {transfer.row.amount}개의 이전을 {actions[transfer.operation]}합니다.
        {transfer.operation !== 'accept' && ' 이 수량은 보낸 기관의 사용 가능 잔액으로 돌아갑니다.'}</p>}
      {error && <p className="text-danger mb-0 mt-2">{error}</p>}
    </Modal>
    <Modal show={!!target} title="발행 승인" onClose={() => setTarget(null)}
      onConfirm={() => submit('issuance/' + target.contract_id + '/approve', {})}
      confirmButtonLabel="승인 확정" confirmButtonDisabled={busy}>
      <p>{target?.payload.symbol} {target?.payload.quantity}개 발행을 승인합니다.</p>
    </Modal>
  </main>;
}
createRoot(document.getElementById('root')).render(<App />);
