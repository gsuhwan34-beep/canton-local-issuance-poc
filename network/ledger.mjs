import fs from 'node:fs';
const client='participant_admin';
const secret=fs.readFileSync(new URL('./participant_admin.secret',import.meta.url),'utf8');
const response=await fetch('http://127.0.0.1:17610/token',{method:'POST',headers:{authorization:'Basic '+Buffer.from(client+':'+secret).toString('base64')},body:new URLSearchParams({grant_type:'client_credentials',scope:'ledger.read'})});
if(!response.ok) throw Error('OIDC '+await response.text());
const {access_token}=await response.json();
export async function api(port,path,body){
 const binary=Buffer.isBuffer(body);
 const res=await fetch('http://127.0.0.1:'+port+'/v2/'+path,{method:body?'POST':'GET',headers:{authorization:'Bearer '+access_token,'content-type':binary?'application/octet-stream':'application/json'},body:binary?body:JSON.stringify(body)});
 const data=await res.text();if(!res.ok)throw Error(path+' '+res.status+' '+data.slice(0,1100));return data?JSON.parse(data):{};
}
