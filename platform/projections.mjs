export const issuanceModule = 'private-canton-issuance:Issuance:';

// The official Quickstart queries PQS by template name. Keep the same boundary
// for active holdings and use PQS creation history when reconciling a retry.
export async function readContracts(db, template, { history = false, contractId, reference } = {}) {
  const identifier = issuanceModule + template;
  const source = history ? 'creates' : 'active';
  const fields = history ? 'contract_id, payload, to_jsonb(event) AS event' : 'contract_id, payload';
  const params = [identifier];
  let where = '';
  if (contractId) {
    params.push(contractId);
    where = ' WHERE contract_id = $2';
  } else if (reference) {
    params.push(reference);
    where = " WHERE lower(payload->>'reference') = lower($2)";
  }
  try {
    return (await db.query(`SELECT ${fields} FROM ${source}($1::text) AS event${where}`, params)).rows;
  } catch (error) {
    // PQS registers identifiers when the first event for a template arrives.
    if (error.code === 'P0001' && error.message === 'Identifier not found: ' + identifier) return [];
    throw error;
  }
}
