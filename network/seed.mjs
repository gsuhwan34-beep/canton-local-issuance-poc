import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { api } from './ledger.mjs';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: {
  'issuer-port': { type: 'string', default: '5013' }, 'broker-port': { type: 'string', default: '5023' }
} });
const [issuerPort, brokerPort] = [values['issuer-port'], values['broker-port']].map(Number);
if (![issuerPort, brokerPort].every(port => Number.isInteger(port) && port > 0 && port <= 65535) ||
    issuerPort === brokerPort) throw new Error('Provide two distinct loopback Ledger API ports.');

const archive = await readFile(new URL('./model/.daml/dist/local-official-iou-1.0.0.dar', import.meta.url));
const iou = '#local-official-iou:Iou:Iou';
const transfer = '#local-official-iou:Iou:IouTransfer';

async function provision(port, name) {
  await api(port, 'packages?vetAllPackages=true', archive);
  const { partyDetails } = await api(port, 'parties');
  const existing = partyDetails.find(p => p.isLocal && p.party.startsWith(name + '::'));
  const { party } = existing ?? (await api(port, 'parties', { partyIdHint: name })).partyDetails;
  const { users } = await api(port, 'users');
  if (!users.some(user => user.id === 'lens-viewer')) {
    await api(port, 'users', {
      user: { id: 'lens-viewer', primaryParty: party },
      rights: [{ kind: { CanReadAs: { value: { party } } } }]
    });
  }
  await api(port, 'users/participant_admin/rights', {
    userId: 'participant_admin', rights: [{ kind: { CanActAs: { value: { party } } } }]
  });
  return party;
}

async function active(port, party, templateId) {
  const { offset } = await api(port, 'state/ledger-end');
  const rows = await api(port, 'state/active-contracts', {
    activeAtOffset: offset,
    eventFormat: { filtersByParty: { [party]: { cumulative: [{
      identifierFilter: { TemplateFilter: { value: { templateId } } }
    }] } }, verbose: true }
  });
  return rows.map(row => row.contractEntry?.JsActiveContract?.createdEvent).filter(Boolean);
}

async function submit(port, party, commandId, commands) {
  await api(port, 'commands/submit-and-wait-for-transaction', {
    commands: { commandId, userId: 'participant_admin', actAs: [party], commands }
  });
}

async function waitForSynchronizer(port) {
  for (let attempt = 0; attempt < 90; attempt++) {
    const { connectedSynchronizers } = await api(port, 'state/connected-synchronizers');
    if (connectedSynchronizers.some(sync => sync.synchronizerAlias === 'da')) return;
    await delay(1000);
  }
  throw new Error('Dedicated synchronizer not connected on ' + port + '. Check network/log/canton.log.');
}
await Promise.all([issuerPort, brokerPort].map(waitForSynchronizer));
const issuer = await provision(issuerPort, 'IssuingDesk');
const broker = await provision(brokerPort, 'BrokerB');
const amountIs = (contract, owner, amount) => contract?.issuer === issuer && contract.owner === owner &&
  contract.currency === 'KRW' && Number(contract.amount) === amount;
const payload = amount => ({ issuer, owner: issuer, currency: 'KRW', amount: String(amount), observers: [] });
const holdings = await active(issuerPort, issuer, iou);
const offers = await active(issuerPort, issuer, transfer);
const matchesOffer = event => event.createArgument.newOwner === broker && amountIs(event.createArgument.iou, issuer, 100);
const received = holdings.some(event => amountIs(event.createArgument, broker, 100));
const commands = [];
if (!holdings.some(event => amountIs(event.createArgument, issuer, 900))) {
  commands.push({ CreateCommand: { templateId: iou, createArguments: payload(900) } });
}
if (!received && !offers.some(matchesOffer)) {
  // Resume a 100-unit holding left by earlier versions of the bootstrap.
  const remainder = holdings.find(event => amountIs(event.createArgument, issuer, 100));
  const choice = { templateId: iou, choice: 'Iou_Transfer', choiceArgument: { newOwner: broker } };
  commands.push(remainder
    ? { ExerciseCommand: { ...choice, contractId: remainder.contractId } }
    : { CreateAndExerciseCommand: { ...choice, createArguments: payload(100) } });
}
if (commands.length) await submit(issuerPort, issuer, 'poc-seed-initial-ious-v1', commands);
if (!received) {
  // The issuer may have finished before the broker's participant indexes the offer.
  let offer;
  for (let attempt = 0; attempt < 60 && !offer; attempt++) {
    offer = (await active(brokerPort, broker, transfer)).find(matchesOffer);
    if (!offer) await delay(500);
  }
  if (!offer) throw new Error('BrokerB has not indexed the seed offer. Rerun startup to resume.');
  await submit(brokerPort, broker, 'poc-seed-accept-100-v1', [{ ExerciseCommand: {
    templateId: transfer, contractId: offer.contractId, choice: 'IouTransfer_Accept', choiceArgument: {}
  } }]);
}
console.log('IOU seed ready: IssuingDesk 900, BrokerB 100.');
