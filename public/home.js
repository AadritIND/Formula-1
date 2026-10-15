const {api,openF1Schedule,escapeHtml,imageOrMark}=window.APEX;

function homeOffsetMinutes(value){const m=String(value||'00:00:00').match(/^([+-]?\d{2}):(\d{2})/);return m?Number(m[1])*60+Math.sign(Number(m[1])||1)*Number(m[2]):0}
function homeLocalDate(session,iso=session.startsAt){if(session.localStart&&iso===session.startsAt)return new Date(session.localStart);return new Date(Date.parse(iso)+homeOffsetMinutes(session.offset)*60000)}
function homeFormatDate(session,iso=session.startsAt){return new Intl.DateTimeFormat(undefined,{weekday:'short',day:'2-digit',month:'short',timeZone:'UTC'}).format(homeLocalDate(session,iso)).toUpperCase()}
function homeFormatTime(session,iso=session.startsAt){return new Intl.DateTimeFormat(undefined,{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'UTC'}).format(homeLocalDate(session,iso))}

function groupHomeSessions(sessions){
  const groups=new Map();
  for(const session of sessions||[]){
    const key=session.meetingId||session.meeting_key;if(!key)continue;
    let race=groups.get(key);
    if(!race){race={meetingId:key,name:session.event||session.meeting_name||`${session.location||''} GRAND PRIX`,location:session.location||'',country:session.country||session.country_name||'',circuit:session.circuit||session.circuit_short_name||'',circuitKey:session.circuitKey||session.circuit_key,startsAt:session.startsAt||session.date_start,endsAt:session.endsAt||session.date_end,sessions:[]};groups.set(key,race)}
    race.sessions.push(session);
    if(Date.parse(session.startsAt||session.date_start)<Date.parse(race.startsAt))race.startsAt=session.startsAt||session.date_start;
    if(Date.parse(session.endsAt||session.date_end)>Date.parse(race.endsAt))race.endsAt=session.endsAt||session.date_end;
  }
  return [...groups.values()].sort((a,b)=>Date.parse(a.startsAt)-Date.parse(b.startsAt));
}

function homeVenueMatch(race,profiles){
  const key=String(race.circuitKey||race.circuit_key||'');
  const identity=`${race.location||''} ${race.circuit||''} ${race.name||''}`.toLocaleLowerCase();
  return profiles.find(p=>String(p.key)===key)||profiles.find(p=>[p.location,p.circuit,p.name,p.slug].filter(Boolean).some(value=>identity.includes(String(value).toLocaleLowerCase())))||null;
}

async function renderNextChapter(){
  const card=document.querySelector('.race-card');if(!card)return;
  const nameEl=document.querySelector('#nextRaceName'),circuitEl=document.querySelector('#nextRaceCircuit'),map=document.querySelector('#nextCircuitMap'),round=document.querySelector('#nextRoundLabel'),date=document.querySelector('#nextRaceDate'),rows=document.querySelector('#nextWeekendSessions'),localLabel=document.querySelector('#nextRaceLocalLabel');
  let races=[],profiles=[];
  try{const data=await api('/api/calendar');races=(data.races||[]).filter(r=>r.sessions?.length)}catch{}
  if(!races.length){try{const schedule=await openF1Schedule();races=groupHomeSessions(schedule.sessions)}catch{}}
  try{profiles=(await api('/api/circuits')).circuits||[]}catch{}
  if(!races.length){nameEl.textContent='THE NEXT GRAND PRIX';circuitEl.textContent='RACE WEEKEND SCHEDULE TEMPORARILY UNAVAILABLE';rows.innerHTML='<div class="session"><span class="session-day">—</span><span class="session-name">Schedule unavailable</span><time>—:—</time><span class="session-status">TRY AGAIN LATER</span></div>';return}
  const now=Date.now(),race=races.find(r=>Date.parse(r.endsAt)>=now)||races.find(r=>Date.parse(r.startsAt)>now)||races.at(-1),sessions=(race.sessions||[]).slice().sort((a,b)=>Date.parse(a.startsAt)-Date.parse(b.startsAt)),visible=sessions.slice(0,6),profile=homeVenueMatch(race,profiles),nextSessionIndex=sessions.findIndex(s=>Date.parse(s.startsAt)>now);
  const eventName=String(race.name||`${race.location} Grand Prix`).toUpperCase(),place=[profile?.circuit||race.circuit,race.location,race.country||profile?.country].filter((value,index,all)=>value&&all.findIndex(x=>String(x).toLowerCase()===String(value).toLowerCase())===index).join(' · ').toUpperCase();
  nameEl.textContent=eventName;circuitEl.textContent=place||'CIRCUIT PROFILE';
  const roundNo=race.round||races.indexOf(race)+1;round.textContent=`ROUND ${String(roundNo).padStart(2,'0')}`;
  const first=sessions[0];date.textContent=first?`${homeFormatDate(first)} — ${homeFormatDate(first,race.endsAt)}`:'SEASON SCHEDULE';
  localLabel.textContent=`LOCAL TIME · UTC${String(race.offset||sessions.find(s=>s.offset)?.offset||'').slice(0,6)}`;
  const image=race.circuitDetailedImage||profile?.detailedImage||race.circuitImage||profile?.carbonImage;
  if(image){map.alt=`Official ${place||eventName} circuit layout`;map.addEventListener('load',()=>card.querySelector('.race-track-fallback')?.remove(),{once:true});map.addEventListener('error',()=>{map.hidden=true;card.classList.remove('has-real-track')},{once:true});map.src=image;map.hidden=false;card.classList.add('has-real-track')}else{map.hidden=true;card.classList.remove('has-real-track')}
  rows.innerHTML=visible.map((s,i)=>{const day=new Intl.DateTimeFormat(undefined,{weekday:'short',timeZone:'UTC'}).format(homeLocalDate(s)).toUpperCase(),stamp=homeFormatDate(s),time=homeFormatTime(s),isLive=Date.parse(s.startsAt)<=now&&Date.parse(s.endsAt)>=now,isDone=Date.parse(s.endsAt)<now,isNext=!isLive&&i===nextSessionIndex;return`<div class="session${isLive||isNext?' upcoming':''}${isDone?' completed':''}"><span class="session-day">${escapeHtml(day)} <small>${escapeHtml(stamp)}</small></span><span class="session-name">${escapeHtml(s.name||'Session')}</span><time>${escapeHtml(time)}</time><span class="session-status">${isLive?'<i class="pulse"></i> LIVE':isNext?'<i class="pulse"></i> NEXT UP':isDone?'✓ COMPLETE':'SCHEDULED'}</span></div>`}).join('');
  if(!visible.length)rows.innerHTML='<div class="session"><span class="session-day">—</span><span class="session-name">Weekend schedule unavailable</span><time>—:—</time><span class="session-status">CALENDAR</span></div>';
}

renderNextChapter().catch(()=>{});
api('/api/public/config').then(c=>{const n=document.querySelector('#homeLiveStatus');if(n)n.textContent=c.status==='live'?'ON AIR':c.status==='complete'?'SESSION COMPLETE':'SCHEDULED'}).catch(()=>{});
api('/api/standings').then(async s=>{if(!s.drivers?.[0]?.headshotUrl){try{s=await window.APEX.openF1Standings()||s}catch{}}const leader=s.drivers?.[0];if(leader){const name=document.querySelector('#homeLeader');name.textContent=leader.name.toUpperCase();name.before(Object.assign(document.createElement('span'),{className:'home-leader-portrait',innerHTML:imageOrMark(leader.headshotUrl,leader.name,'home-leader-face',leader.code||'F1')}));name.nextElementSibling.textContent=`DRIVER STANDINGS · ${leader.points} POINTS`}}).catch(()=>{});
document.querySelector('#newsletterForm')?.addEventListener('submit',async e=>{e.preventDefault();const msg=document.querySelector('#newsletterMessage');try{await api('/api/newsletter',{method:'POST',body:JSON.stringify({email:document.querySelector('#emailInput').value,consent:document.querySelector('#emailConsent').checked})});msg.textContent='YOU’RE ON THE GRID. YOU CAN UNSUBSCRIBE ANY TIME.';e.target.reset()}catch(err){msg.textContent=err.message}});
