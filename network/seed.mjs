import {api} from './ledger.mjs';
import fs from 'node:fs';
const dar=fs.readFileSync(new URL('./model/.daml/dist/local-official-iou-1.0.0.dar', import.meta.url));
const parties=[];
for(const [port,name] of [[5013,'IssuingDesk'],[5023,'BrokerB']]){
 await api(port,'packages?vetAllPackages=true',dar);
 const list=await api(port,'parties');
 const existing=list.partyDetails.find(p=>p.party.startsWith(name+'::'));
 const party=(existing??(await api(port,'parties',{partyIdHint:name})).partyDetails).party;
 parties.push(party);
 const right=(key)=>({kind:{[key]:{value:{party}}}});
 const users=await api(port,'users');
 if(!users.users.some(u=>u.id==='lens-viewer')) await api(port,'users',{user:{id:'lens-viewer',primaryParty:party},rights:[right('CanReadAs')]});
 await api(port,'users/participant_admin/rights',{userId:'participant_admin',rights:[right('CanActAs')]});
}
const [issuer,broker]=parties;
async function submit(port,party,command){
 const data=await api(port,'commands/submit-and-wait-for-transaction',{commands:{commandId:crypto.randomUUID(),userId:'participant_admin',actAs:[party],commands:[command]}});
 return data.transaction.events.map(e=>e.CreatedEvent?.value??e.CreatedEvent).filter(Boolean);
}
const id='#local-official-iou:Iou:';
const issue=amount=>submit(5013,issuer,{CreateCommand:{templateId:id+'Iou',createArguments:{issuer,owner:issuer,currency:'KRW',amount,observers:[]}}});
const exercise=(port,who,templateId,contractId,choice,choiceArgument)=>submit(port,who,{ExerciseCommand:{templateId:id+templateId,contractId,choice,choiceArgument}});
const retained=await issue('900');console.log('Issuer holding',retained[0]?.contractId);
const [toMove]=await issue('100');
const [offer]=await exercise(5013,issuer,'Iou',toMove.contractId,'Iou_Transfer',{newOwner:broker});
const [received]=await exercise(5023,broker,'IouTransfer',offer.contractId,'IouTransfer_Accept',{});
console.log('Broker accepted',received.contractId);
