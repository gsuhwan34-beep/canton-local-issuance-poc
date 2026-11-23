import { ledgerClient } from '../platform/ledger-api.mjs';

export const api = await ledgerClient('participant_admin');
