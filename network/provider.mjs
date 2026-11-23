import Provider from 'oidc-provider';
import fs from 'node:fs';
import crypto from 'node:crypto';
const issuer = 'http://127.0.0.1:17610';
const audience = 'http://127.0.0.1:7575';
const clients = ['participant_admin','lens-viewer'].map(client_id => {
  const path = client_id+'.secret';
  if (!fs.existsSync(path)) fs.writeFileSync(path, crypto.randomBytes(48).toString('hex'));
  return {client_id, client_secret:fs.readFileSync(path,'utf8'),grant_types:['client_credentials'],response_types:[],redirect_uris:[],token_endpoint_auth_method:'client_secret_basic'};
});
const key = crypto.generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({format:'jwk'});
const provider = new Provider(issuer,{
  jwks:{keys:[{...key,use:'sig',alg:'RS256',kid:crypto.randomUUID()}]},clients,scopes:['ledger.read'],
  features:{devInteractions:{enabled:false},clientCredentials:{enabled:true}, resourceIndicators:{
    enabled:true,defaultResource:()=>audience,
    getResourceServerInfo:()=>({accessTokenTTL:90,scope:'ledger.read',audience,accessTokenFormat:'jwt',jwt:{sign:{alg:'RS256'}}})
  }}
});
provider.listen(17610,'127.0.0.1');
