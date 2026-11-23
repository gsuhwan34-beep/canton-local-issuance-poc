import { registryOperatorUrl, operatorParty, instrumentUrl, instrumentDetails } from './registry.mjs';

async function get(url) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`${new URL(url).hostname} returned HTTP ${response.status}`);
  return response;
}

async function readRegistry() {
  const operator = operatorParty(await (await get(registryOperatorUrl)).json());
  const instrument = instrumentDetails(await (await get(instrumentUrl(operator))).json());
  return { operator, instrument };
}

const [registry, noves] = await Promise.allSettled([
  readRegistry(),
  get('https://ccdata.noves.fi/').then(response => ({ dashboardStatus: response.status, api: 'NOVES_API_KEY required' }))
]);
for (const [service, result] of [['DA Registry DevNet operator', registry], ['Noves public Canton data', noves]]) {
  if (result.status === 'fulfilled') console.log(service, JSON.stringify(result.value));
  else {
    process.exitCode = 1;
    console.error(service, result.reason.message);
  }
}
