import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import { ledgerClient } from '../platform/ledger-api.mjs';

const [dar, mode] = process.argv.slice(2);
if (!dar) throw new Error('Pass the built Splice TestTokenV1 DAR.');
if (mode !== undefined && mode !== '--install-only') throw new Error('Unknown mode: ' + mode);

const template = '#splice-test-token-v1:Splice.Testing.Tokens.TestTokenV1:';
const holdingInterface = '#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding';
const transferModule = '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:';
const issuerPort = 5013;
const receiverPort = 5023;
const admin = await ledgerClient('participant_admin');
const archive = await readFile(dar);
await Promise.all([issuerPort, receiverPort].map(port => admin(port, 'packages?vetAllPackages=true', archive)));
if (mode === '--install-only') {
  console.log('Splice TestTokenV1 DAR installed on both participants.');
  process.exit(0);
}
const [writer, reader] = await Promise.all(['platform-writer', 'lens-viewer'].map(ledgerClient));

async function partyOn(port, hint) {
  const { partyDetails } = await admin(port, 'parties');
  const party = partyDetails.find(entry => entry.isLocal && entry.party.startsWith(hint + '::'));
  if (!party) throw new Error('Start the local platform to provision ' + hint + '.');
  return party.party;
}

async function submit(port, party, command) {
  const { transaction } = await writer(port, 'commands/submit-and-wait-for-transaction', {
    commands: { commandId: randomUUID(), userId: 'platform-writer', actAs: [party], commands: [command] }
  });
  return transaction.events.map(event => event.CreatedEvent?.value ?? event.CreatedEvent).filter(Boolean);
}

function created(events, name) {
  const event = events.find(entry => entry.templateId.endsWith(':' + name));
  assert.ok(event, 'Missing created ' + name);
  return event.contractId;
}

async function activeContracts(port, party, interfaceId) {
  const { offset } = await reader(port, 'state/ledger-end');
  const rows = await reader(port, 'state/active-contracts', {
    activeAtOffset: offset,
    eventFormat: { filtersByParty: { [party]: { cumulative: [{
      identifierFilter: { InterfaceFilter: { value: { interfaceId, includeInterfaceView: true } } }
    }] } }, verbose: true }
  });
  return rows.map(row => row.contractEntry?.JsActiveContract?.createdEvent).filter(Boolean);
}

async function holdings(port, party, instrument) {
  return (await activeContracts(port, party, holdingInterface)).flatMap(event => event.interfaceViews ?? [])
    .map(view => view.viewValue)
    .filter(view => view?.instrumentId.admin === instrument.admin && view.instrumentId.id === instrument.id);
}

const [issuer, receiver] = await Promise.all([partyOn(issuerPort, 'IssuingDesk'), partyOn(receiverPort, 'BrokerB')]);
const instrumentId = { admin: issuer, id: 'DEMO-BOND-' + randomUUID() };
const meta = { values: {} };
const extraArgs = { context: { values: {} }, meta };
const exercise = (choice, id, args, interfaceName) => ({
  ExerciseCommand: { templateId: transferModule + interfaceName, contractId: id, choice, choiceArgument: args }
});

const rules = created(await submit(issuerPort, issuer, {
  CreateCommand: { templateId: template + 'TokenRules', createArguments: { admin: issuer } }
}), 'TokenRules');
const minted = created(await submit(issuerPort, issuer, {
  CreateCommand: {
    templateId: template + 'Token',
    createArguments: { holding: { owner: issuer, instrumentId, amount: '125.0', lock: null, meta } }
  }
}), 'Token');
assert.deepEqual((await holdings(issuerPort, issuer, instrumentId)).map(view => Number(view.amount)), [125]);
assert.deepEqual(await holdings(receiverPort, receiver, instrumentId), []);

const now = Date.now();
const offer = created(await submit(issuerPort, issuer, exercise('TransferFactory_Transfer', rules, {
  expectedAdmin: issuer,
  transfer: {
    sender: issuer, receiver, amount: '50.0', instrumentId, requestedAt: new Date(now - 1000).toISOString(),
    executeBefore: new Date(now + 600000).toISOString(), inputHoldingCids: [minted], meta
  },
  extraArgs
}, 'TransferFactory')), 'TokenTransferOffer');

// The sender's completion can arrive before the receiving participant indexes its offer.
let offerVisible = false;
for (let attempt = 0; attempt < 30 && !offerVisible; attempt++) {
  const instructions = await activeContracts(receiverPort, receiver, transferModule + 'TransferInstruction');
  offerVisible = instructions.some(event => event.contractId === offer);
  if (!offerVisible) await setTimeout(300);
}
assert.ok(offerVisible, 'The receiving participant has not indexed the transfer offer.');
const received = created(await submit(receiverPort, receiver, exercise('TransferInstruction_Accept', offer,
  { extraArgs }, 'TransferInstruction')), 'Token');
const [issuerViews, receiverViews] = await Promise.all([
  holdings(issuerPort, issuer, instrumentId), holdings(receiverPort, receiver, instrumentId)
]);
assert.deepEqual(issuerViews.filter(view => view.owner === issuer).map(view => Number(view.amount)), [75]);
assert.deepEqual(receiverViews.map(view => [view.owner, Number(view.amount)]), [[receiver, 50]]);
console.log(JSON.stringify({ instrument: instrumentId.id, minted: 125, issuerBalance: 75,
  receiverBalance: 50, receivedContractId: received }, null, 2));
