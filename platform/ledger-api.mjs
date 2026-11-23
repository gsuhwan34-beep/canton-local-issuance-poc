import { readFile } from 'node:fs/promises';

export async function ledgerClient(user) {
  const secret = (await readFile(new URL('../network/' + user + '.secret', import.meta.url), 'utf8')).trim();
  let cached;
  async function token() {
    if (cached && cached.until > Date.now()) return cached.value;
    const response = await fetch('http://127.0.0.1:17610/token', {
      method: 'POST',
      headers: { authorization: 'Basic ' + Buffer.from(user + ':' + secret).toString('base64') },
      body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'ledger.read' }),
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) throw new Error('Ledger authentication failed');
    const value = await response.json();
    cached = { value: value.access_token, until: Date.now() + (value.expires_in - 15) * 1000 };
    return cached.value;
  }
  return async function ledger(port, path, body) {
    const binary = Buffer.isBuffer(body);
    const response = await fetch('http://127.0.0.1:' + port + '/v2/' + path, {
      method: body ? 'POST' : 'GET',
      headers: { authorization: 'Bearer ' + await token(), 'content-type': binary ? 'application/octet-stream' : 'application/json' },
      body: binary ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(20000)
    });
    const payload = await response.json();
    if (!response.ok) throw Object.assign(new Error('Ledger command failed: ' + payload.code), { status: response.status, ledgerCode: payload.code });
    return payload;
  };
}
