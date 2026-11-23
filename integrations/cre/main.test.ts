import { expect } from 'bun:test';
import { HttpActionsMock, newTestRuntime, test } from '@chainlink/cre-sdk/test';
import { registryOperatorUrl, instrumentUrl } from '../registry.mjs';
import { checkRegistry } from './registry-workflow';

test('uses the DA operator to resolve the instrument through the CRE HTTP capability', () => {
  const mock = HttpActionsMock.testInstance();
  const operator = 'demo-operator::1220ab';
  const instrument = { id: 'TestToken', symbol: 'TestToken', decimals: 10 };
  mock.sendRequest = request => {
    expect([registryOperatorUrl, instrumentUrl(operator)]).toContain(request.url);
    return { statusCode: 200, headers: {},
      body: new TextEncoder().encode(JSON.stringify(request.url === registryOperatorUrl ? { partyId: operator } : instrument)) };
  };
  expect(checkRegistry(newTestRuntime())).toEqual({ environment: 'devnet', operator, ...instrument });
});

test('rejects an operator response without a Party ID', () => {
  const mock = HttpActionsMock.testInstance();
  mock.sendRequest = () => ({ statusCode: 200, headers: {}, body: new TextEncoder().encode('{}') });
  expect(() => checkRegistry(newTestRuntime())).toThrow('invalid operator party ID');
});
