/**
 * internal milestone — which open rooms are handed over when their holder goes away (owner decisions 2026-11-04), pure and
 * import-free. A room is handed over when its holder is `Borte` with a `B · Borte til` date and the room's frozen due
 * day falls on or before that date; a resident back before the due day keeps the room. Only an open, unaccepted head
 * (`READY`) is handed over; a room already overdue is handed over too, its charged steps staying with the holder.
 * The receiver, the new due day (a full period from the handover day) and the holder's Borte credit come from the
 * ordinary planner (`planCleaningCycle` with `handover: true`).
 */
const DAY=/^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/,ID=/^[a-f0-9]{24}$/;
const fail=what=>{throw Error('HANDOVER_RULE_INPUT_'+what);};

/**
 * @param {{residents:Array<{memberId:string,status:'Aktiv'|'Borte',untilDay:string|null}>,
 *  rooms:Array<{zone:string,holderId:string,dueDay:string,phase:string}>}} s
 * @returns {string[]} the zones to hand over, in the given room order
 */
export function roomsToHandOver({residents,rooms}={}){
 if(!Array.isArray(residents)||residents.length!==6||!Array.isArray(rooms)||rooms.length>6)fail('SHAPE');
 const away=new Map();
 for(const r of residents){
  if(typeof r?.memberId!=='string'||!ID.test(r.memberId)||away.has(r.memberId)||!['Aktiv','Borte'].includes(r.status)||r.untilDay!==null&&(typeof r.untilDay!=='string'||!DAY.test(r.untilDay)))fail('RESIDENT');
  away.set(r.memberId,r.status==='Borte'?r.untilDay:undefined);
 }
 const zones=new Set(),out=[];
 for(const room of rooms){
  if(typeof room?.zone!=='string'||!room.zone||zones.has(room.zone)||typeof room.dueDay!=='string'||!DAY.test(room.dueDay)||typeof room.phase!=='string'||!away.has(room.holderId))fail('ROOM');
  zones.add(room.zone);
  const until=away.get(room.holderId);
  if(room.phase==='READY'&&typeof until==='string'&&room.dueDay<=until)out.push(room.zone);
 }
 return out;
}
