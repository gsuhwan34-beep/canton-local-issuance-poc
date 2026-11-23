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
  if (!response.ok) throw Error(json.error || '요청이 거절되었습니다 (' + response.status + ')');
  return json;
}

function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState(null);
  const [reference, setReference] = useState(generateCommandId);
  const update = () => api('contracts').then(setData).catch(e => setError(e.message));
  useEffect(() => {
    update();
    const interval = setInterval(update, 3500);
    return () => clearInterval(interval);
  }, []);

  async function submit(path, payload) {
    setBusy(true); setError(''); setInfo('');
    try {
      const result = await api(path, payload);
      const state = result.projectionStatus === 'confirmed' ? '기관별 조회 DB 반영 확인' : '기관별 조회 DB 반영 대기';
      setInfo('원장 확정 · ' + state + ' · ' + result.workflowId);
      setTarget(null);
      if (path === 'issuance') setReference(generateCommandId());
      await update();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return <main className="container py-5">
    <header className="d-flex flex-wrap justify-content-between align-items-start gap-3 pb-4 border-bottom">
      <div><div className="text-uppercase text-secondary small">Canton 사설망</div>
        <h1 className="display-5 fw-semibold">증권 발행 실증</h1>
        {data && <p className="text-secondary mb-0">{data.role === 'issuer' ? '발행기관 · IssuingDesk' : '승인기관 · BrokerB'}</p>}
      </div>
      <div className="d-flex gap-2">
        <a className="btn btn-outline-primary" href="http://127.0.0.1:8233/" target="_blank" rel="noreferrer">워크플로 이력</a>
        <button className="btn btn-outline-secondary" onClick={() => auth.logout({ redirectUri: location.origin })}>로그아웃</button>
      </div>
    </header>
    {error && <p role="alert" className="alert alert-danger mt-3">{error}</p>}
    {info && <p role="status" className="alert alert-success mt-3 text-break">{info}</p>}
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
            <thead><tr><th>종목</th><th>수량</th><th>계약 ID</th><th aria-label="작업"></th></tr></thead>
            <tbody>{rows.map(row => <tr key={row.contract_id}>
              <td>{row.payload.symbol}</td><td>{row.payload.quantity}</td>
              <td><code title={row.contract_id}>{row.contract_id.slice(0, 12)}…</code></td>
              <td>{index === 0 && data.role === 'approver' && <button className="btn btn-primary btn-sm" onClick={() => setTarget(row)}>승인</button>}</td>
            </tr>)}</tbody>
          </table></div>}
      </section>)}
    <Modal show={!!target} title="발행 승인" onClose={() => setTarget(null)}
      onConfirm={() => submit('issuance/' + target.contract_id + '/approve', {})}
      confirmButtonLabel="승인 확정" confirmButtonDisabled={busy}>
      <p>{target?.payload.symbol} {target?.payload.quantity}개 발행을 승인합니다.</p>
    </Modal>
  </main>;
}
createRoot(document.getElementById('root')).render(<App />);
