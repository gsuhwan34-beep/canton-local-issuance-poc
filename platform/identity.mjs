import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const runtime = join(process.env.LOCALAPPDATA, 'CantonPrivatePoc', 'runtime');
const keycloak = join(runtime, 'keycloak-26.8.2');
const importDir = join(keycloak, 'data', 'import');
const credentialsFile = join(runtime, 'platform-demo-accounts.json');
if (!existsSync(credentialsFile)) {
  const accounts = ['issuer-demo', 'approver-demo'].map(username => ({
    username, password: randomBytes(18).toString('base64url')
  }));
  writeFileSync(credentialsFile, JSON.stringify(accounts, null, 2));
}
const accounts = JSON.parse(readFileSync(credentialsFile, 'utf8'));
mkdirSync(importDir, { recursive: true });
const origin = 'http://127.0.0.1:18090';
const realm = {
  realm: 'canton-poc',
  enabled: true,
  sslRequired: 'external',
  accessTokenLifespan: 300,
  clients: [{
    clientId: 'canton-platform',
    enabled: true,
    publicClient: true,
    standardFlowEnabled: true,
    directAccessGrantsEnabled: false,
    redirectUris: [origin + '/*'],
    webOrigins: [origin],
    attributes: { 'pkce.code.challenge.method': 'S256' },
    protocolMappers: [{
      name: 'platform audience',
      protocol: 'openid-connect',
      protocolMapper: 'oidc-audience-mapper',
      config: { 'included.client.audience': 'canton-platform', 'access.token.claim': 'true' }
    }]
  }],
  users: accounts.map(({ username, password }) => ({
    username, enabled: true, firstName: 'Canton', lastName: 'Demo',
    email: username + '@example.invalid', emailVerified: true,
    credentials: [{ type: 'password', value: password, temporary: false }]
  }))
};
writeFileSync(join(importDir, 'canton-poc-realm.json'), JSON.stringify(realm, null, 2));
