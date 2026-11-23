const { proxyActivities } = require('@temporalio/workflow');

const { submitIssuanceCommand } = proxyActivities({
  startToCloseTimeout: '30 seconds',
  retry: { maximumAttempts: 4, maximumInterval: '5 seconds' }
});

const { confirmProjections } = proxyActivities({
  startToCloseTimeout: '8 seconds',
  retry: { initialInterval: '500 milliseconds', maximumInterval: '3 seconds', maximumAttempts: 7 }
});

async function issuanceCommand(request) {
  const receipt = await submitIssuanceCommand(request);
  let projectionStatus = 'confirmed';
  try {
    await confirmProjections(request, receipt.contractId);
  } catch {
    // Submission has already succeeded. A read model outage must not turn
    // a committed ledger transaction into a reported write failure.
    projectionStatus = 'pending';
  }
  return { ...receipt, requestHash: request.requestHash, projectionStatus };
}

module.exports = { issuanceCommand };
