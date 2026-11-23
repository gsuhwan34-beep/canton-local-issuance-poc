export const issuanceModule = 'private-canton-issuance:Issuance:';

// The official Quickstart queries PQS by template name. Keep the same boundary
// for active holdings and use PQS creation history when reconciling a retry.
export async function readContracts(db, template, { history = false, contractId, reference, module = issuanceModule, inSnapshot = false } = {}) {
  const identifier = module + template;
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
  if (inSnapshot) await db.query('SAVEPOINT template_read');
  try {
    const { rows } = await db.query(`SELECT ${fields} FROM ${source}($1::text) AS event${where}`, params);
    if (inSnapshot) await db.query('RELEASE SAVEPOINT template_read');
    return rows;
  } catch (error) {
    // PQS registers identifiers when the first event for a template arrives.
    if (error.code === 'P0001' && error.message === 'Identifier not found: ' + identifier) {
      if (inSnapshot) {
        await db.query('ROLLBACK TO SAVEPOINT template_read');
        await db.query('RELEASE SAVEPOINT template_read');
      }
      return [];
    }
    throw error;
  }
}
