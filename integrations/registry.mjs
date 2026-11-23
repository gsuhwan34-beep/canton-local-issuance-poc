export const registryOperatorUrl = 'https://api.utilities.digitalasset-dev.com/api/utilities/v0/operator';

/** @param {unknown} response */
export function operatorParty(response) {
  const value = typeof response === 'object' && response !== null && 'partyId' in response
    ? response.partyId : undefined;
  if (typeof value !== 'string' || !/^[\w.#:-]+::[a-f0-9]+$/i.test(value)) {
    throw new Error('DA Registry returned an invalid operator party ID.');
  }
  return value;
}

export const devnetInstrument = 'TestToken';

/** @param {string} party */
export function instrumentUrl(party) {
  return 'https://api.utilities.digitalasset-dev.com/api/token-standard/v0/registrars/' +
    encodeURIComponent(party) + '/registry/metadata/v1/instruments/' + devnetInstrument;
}

/** @param {unknown} value */
export function instrumentDetails(value) {
  if (!value || typeof value !== 'object' || !('id' in value) || value.id !== devnetInstrument ||
      !('symbol' in value) || typeof value.symbol !== 'string' ||
      !('decimals' in value) || typeof value.decimals !== 'number') {
    throw new Error('Unexpected Registry instrument metadata.');
  }
  return { id: value.id, symbol: value.symbol, decimals: value.decimals };
}
