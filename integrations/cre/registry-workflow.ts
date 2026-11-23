import {
  consensusIdenticalAggregation,
  cre,
  json,
  ok,
  type HTTPSendRequester,
  type Runtime
} from '@chainlink/cre-sdk';
import { operatorParty, registryOperatorUrl, instrumentUrl, instrumentDetails } from '../registry.mjs';

export type Config = { schedule: string };

function readJson(requester: HTTPSendRequester, url: string) {
  const response = requester.sendRequest({ url, method: 'GET' }).result();
  if (!ok(response)) throw new Error(`DA Registry returned HTTP ${response.statusCode}`);
  return json(response);
}

function fetchInstrument(requester: HTTPSendRequester) {
  const operator = operatorParty(readJson(requester, registryOperatorUrl));
  const instrument = instrumentDetails(readJson(requester, instrumentUrl(operator)));
  return JSON.stringify({ operator, ...instrument });
}

export function checkRegistry(runtime: Runtime<Config>) {
  const http = new cre.capabilities.HTTPClient();
  const agreed = http.sendRequest(runtime, fetchInstrument, consensusIdenticalAggregation<string>())().result();
  return { environment: 'devnet', ...JSON.parse(agreed) };
}
