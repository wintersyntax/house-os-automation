/**
 * internal milestone — `B · Borte til` rules (owner decisions 2026-11-04), pure and import-free.
 *
 * The date on a resident's profile card is the only input: a resident is `Borte` through that Oslo day (inclusive) and
 * `Aktiv` from 00:00 the day after, when Husbot also clears the date. Without a date the resident is `Aktiv`; a status
 * set by hand is restored. Each change is told in one Norwegian comment on the profile card (its member is notified).
 * internal milestone: clearing the date (or a status set to `Aktiv` by hand) while away is an early return.
 */
export const AWAY_FIELDS=Object.freeze({status:'B · Status',until:'B · Borte til'});
export const AWAY_STATUSES=Object.freeze(['Aktiv','Borte']);
const DAY=/^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const fail=what=>{throw Error('AWAY_RULE_INPUT_'+what);};
const short=day=>day.slice(8,10)+'.'+day.slice(5,7)+'.';
/** The calendar day after `day` (`YYYY-MM-DD`). */
export function nextDay(day){
 if(typeof day!=='string'||!DAY.test(day))fail('DAY');
 const d=new Date(Date.UTC(Number(day.slice(0,4)),Number(day.slice(5,7))-1,Number(day.slice(8,10))+1));
 return d.toISOString().slice(0,10);
}

/**
 * @param {{today:string,status:string|null,untilDay:string|null,wasAway?:boolean}} r `today` and `untilDay` as Oslo days
 *  (`YYYY-MM-DD`); `status` is the profile's current `B · Status` (null when unset); `wasAway`: Husbot's last event for
 *  this resident was leaving (internal milestone), so the date disappearing means an early return.
 * @returns {{status:'Aktiv'|'Borte',clearUntil:boolean,event:null|'LEFT'|'BACK'|'PAST'|'RESTORED',untilDay:string|null}}
 *  `event` names what the comment says; null when nothing needs telling (or the change is only setting an unset status).
 */
export function awayPlan({today,status,untilDay,wasAway=false}){
 if(typeof today!=='string'||!DAY.test(today))fail('TODAY');
 if(status!==null&&!AWAY_STATUSES.includes(status))fail('STATUS');
 if(untilDay!==null&&(typeof untilDay!=='string'||!DAY.test(untilDay)))fail('UNTIL');
 if(untilDay!==null&&untilDay>=today)return {status:'Borte',clearUntil:false,event:'LEFT',untilDay};
 if(typeof wasAway!=='boolean')fail('WAS_AWAY');
 if(untilDay!==null)return {status:'Aktiv',clearUntil:true,event:status==='Borte'||wasAway?'BACK':'PAST',untilDay};
 if(wasAway)return {status:'Aktiv',clearUntil:false,event:'BACK',untilDay:null};
 return {status:'Aktiv',clearUntil:false,event:status==='Borte'?'RESTORED':null,untilDay:null};
}

/**
 * internal milestone (owner decision 2026-11-04): leaving and coming back are each a new comment (the member is notified); a
 * changed date edits the leaving comment, and the two explanations edit each other.
 */
export function editsPrevious(event,previous){
 return event==='LEFT'&&previous==='LEFT'||['RESTORED','PAST'].includes(event)&&['RESTORED','PAST'].includes(previous);
}

/**
 * internal milestone (owner decision 2026-11-04): only the resident changes their own `B · Borte til`; a change by anyone else is
 * put back with this explanation on the profile card (its member is notified).
 */
export function foreignChangeComment(name){
 if(typeof name!=='string'||!/^[\p{L}' -]{1,40}$/u.test(name))fail('NAME');
 return 'ℹ️ Bare **'+name+'** kan endre **B · Borte til** på dette kortet. Husbot satte den tilbake.';
}

/**
 * Husbot's comment for an event (`LEFT` once per date: leaving and every changed date). internal milestone: `handedOver` lists the
 * rooms handed over during this trip (`{room, receiver}`, in order), one line each under the leaving comment.
 */
export function awayComment({event,untilDay,handedOver=[]}){
 if(!Array.isArray(handedOver)||handedOver.length>6||handedOver.some(h=>!h||typeof h.room!=='string'||!/^[\p{L}0-9 +]{1,24}$/u.test(h.room)||typeof h.receiver!=='string'||!/^[\p{L}' -]{1,40}$/u.test(h.receiver)))fail('HANDED_OVER');
 if(event!=='LEFT'&&handedOver.length)fail('HANDED_OVER');
 if(event==='LEFT'){if(typeof untilDay!=='string'||!DAY.test(untilDay))fail('UNTIL');
  return '🧳 **Borte til og med '+short(untilDay)+'** · Du får ingen nye rom før du er tilbake. Du er **Aktiv** igjen fra '+short(nextDay(untilDay))+
   handedOver.map(h=>'\n🔁 **'+h.room+'** er gitt videre til **'+h.receiver+'**.').join('');}
 if(event==='BACK')return '👋 **Velkommen hjem!** Du er **Aktiv** igjen og kan få rom fra i dag.';
 if(event==='PAST'){if(typeof untilDay!=='string'||!DAY.test(untilDay))fail('UNTIL');
  return 'ℹ️ Datoen '+short(untilDay)+' er passert, så du er fortsatt **Aktiv**. Sett **B · Borte til** til siste dag du er borte.';}
 if(event==='RESTORED')return 'ℹ️ **B · Status** følger **B · Borte til**. Sett datoen for siste dag du er borte, så ordner Husbot resten.';
 return fail('EVENT');
}
