const {api,escapeHtml}=window.APEX;const screen=document.querySelector('#liveScreen');let raceControl=null;
const $=s=>document.querySelector(s);
// What the broadcast window is allowed to claim. The operator-approved embed is
// the picture, not the proof that anything is running: only the session state
// (the same answer the timing tower and the radio panel read) can put this
// panel on air, so a forgotten operator switch cannot leave the page saying ON
// AIR through a quiet week. The stream still opens an hour before each session —
// the pre-show — on its own window, so it appears every weekend without anyone
// touching the switch.
let liveState=null,lastProbeLive=null,feedError='',broadcastConfig=null;
function broadcastWindow(){const b=liveState&&liveState.broadcast;return Boolean(b&&b.open)}
function broadcastLive(){return Boolean(broadcastConfig&&broadcastConfig.status==='live'&&broadcastConfig.streamUrl&&liveState&&(liveState.live||broadcastWindow()))}
function streamLead(){
  const b=liveState&&liveState.broadcast,s=b&&b.session,start=s&&s.startsAt?Date.parse(s.startsAt):NaN;
  if(!Number.isFinite(start))return 'PRE-SHOW';
  const mins=Math.max(0,Math.round((start-Date.now())/60000));
  if(mins>=60){const h=Math.floor(mins/60),m=mins%60;return `PRE-SHOW · LIGHTS OUT IN ${h}H${m?' '+m+'M':''}`}
  return mins>0?`PRE-SHOW · LIGHTS OUT IN ${mins} MIN`:'PRE-SHOW · LIGHTS OUT';
}
function renderBroadcast(){
  const status=$('#statusPill');if(!status||!broadcastConfig)return;
  const live=broadcastLive(),onAir=Boolean(liveState&&liveState.live),preShow=live&&!onAir,statusText=broadcastConfig.status;
  status.className=`status-pill ${live?'live':onAir?'scheduled':statusText==='complete'?'complete':'scheduled'}`;
  status.textContent=live?(preShow?'● PRE-SHOW LIVE':'● ON AIR'):onAir?'● SESSION LIVE · NO STREAM':'● NEXT SESSION';
  const lockup=screen.querySelector('.broadcast-lockup'),corner=screen.querySelector('.broadcast-corner'),scan=screen.querySelector('.broadcast-scan'),foot=screen.querySelector('.broadcast-foot');
  lockup?.toggleAttribute('hidden',live);corner?.toggleAttribute('hidden',live);scan?.toggleAttribute('hidden',live);
  if(corner)corner.innerHTML=live?'APEX <span>LIVE</span>':'APEX <span>RACE CONTROL</span>';
  if(foot)foot.innerHTML=live?`${escapeHtml(broadcastConfig.sessionLabel||'LIVE SESSION')} <span>${escapeHtml(preShow?streamLead():'OPERATOR EMBED')}</span>`:`STREAM WILL APPEAR HERE <span>OPENS ${escapeHtml(leadLabel())} BEFORE THE SESSION</span>`;
  mountBroadcast(live?broadcastConfig.streamUrl:'',broadcastConfig.sessionLabel);
}
function leadLabel(){
  const b=liveState&&liveState.broadcast,mins=b&&b.leadMs?Math.round(b.leadMs/60000):60;
  if(mins%60)return `${mins} MIN`;
  const h=mins/60;return h===1?'1 HOUR':`${h} HOURS`;
}
// The operator-approved embed arrives with the pre-show — an hour before the
// session and through to the flag — and it brings its own play, volume and
// fullscreen controls, so the 16:9 window is handed straight to the provider.
function mountBroadcast(url,label){const host=screen?.querySelector('.broadcast-frame');if(!host)return;const current=host.querySelector('iframe');if(!url){current?.remove();return}if(current&&current.dataset.source===url)return;current?.remove();const el=document.createElement('iframe');el.dataset.source=url;el.title=label||'Race broadcast';el.setAttribute('allow','autoplay; encrypted-media; picture-in-picture; fullscreen');el.setAttribute('referrerpolicy','strict-origin-when-cross-origin');el.src=url;host.insertAdjacentElement('afterbegin',el)}
function offsetMinutes(value){const m=String(value||'00:00:00').match(/^([+-]?\d{2}):(\d{2})/);return m?(Number(m[1])*60+Math.sign(Number(m[1])||1)*Number(m[2])):0}
function shiftedDate(iso,offset){return new Date(Date.parse(iso)+offsetMinutes(offset)*60000)}
function dateText(date,options={}){return new Intl.DateTimeFormat(undefined,{timeZone:'UTC',...options}).format(date)}
function eventTime(s,iso){return `${dateText(shiftedDate(iso,s.offset),{weekday:'long',day:'2-digit',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'})} · UTC${s.offset&&s.offset!=='00:00:00'?s.offset.slice(0,6):'+00:00'}`}
function renderClock(){if(!raceControl)return;const s=raceControl.activeSession||raceControl.nextSession,active=Boolean(raceControl.activeSession);const state=$('#sessionState'),countdown=$('#sessionCountdown');if(!s){state.className='status-pill complete';state.textContent='● SEASON BREAK';$('#sessionEvent').textContent='NO MORE SESSIONS THIS SEASON';$('#sessionName').textContent=raceControl.latestSession?`${raceControl.latestSession.event} · ${raceControl.latestSession.name}`:'No upcoming session published';$('#sessionWhere').textContent='No later session is listed in the season schedule.';countdown.innerHTML='<span>—</span><span>—</span><span>—</span><span>—</span>';$('#sessionHeadline').textContent='The chequered flag for this calendar.';$('#sessionDetail').textContent='Check back when the next season schedule is published.';$('#sessionWindow').textContent='No future session listed';$('#nextSessionCard').textContent='Season schedule complete';$('#nextSessionTime').textContent='No further sessions are currently listed';return}
const now=Date.now(),target=Date.parse(active?s.endsAt:s.startsAt),left=Math.max(0,Math.floor((target-now)/1000));state.className=`status-pill ${active?'live':'scheduled'}`;state.textContent=active?'● SESSION UNDERWAY':'● NEXT SESSION';$('#sessionEvent').textContent=s.event.toUpperCase();$('#sessionName').textContent=active?`${s.name} · IN PROGRESS`:`${s.name} STARTS IN`;$('#sessionWhere').textContent=`${s.circuit||'Circuit TBC'} · ${s.location||''}, ${s.country||''} · UTC${s.offset&&s.offset!=='00:00:00'?s.offset.slice(0,6):'+00:00'}`;$('#sessionHeadline').textContent=active?'The session is on.':'Stand by for lights out.';$('#sessionDetail').textContent=active?`${s.name} is scheduled to finish at the time below. Live timing and car telemetry are not displayed here.`:`${s.name} is the next session in the published ${s.event} weekend schedule.`;$('#sessionWindow').textContent=`${eventTime(s,s.startsAt)} — ${dateText(shiftedDate(s.endsAt,s.offset),{hour:'2-digit',minute:'2-digit',timeZone:'UTC'})}`;$('#nextSessionCard').textContent=`${s.event} · ${s.name}`;$('#nextSessionTime').textContent=eventTime(s,s.startsAt);const days=Math.floor(left/86400),hours=Math.floor(left%86400/3600),mins=Math.floor(left%3600/60),secs=left%60;countdown.innerHTML=[days,hours,mins,secs].map(n=>`<span>${String(n).padStart(2,'0')}</span>`).join('');const localNow=shiftedDate(new Date().toISOString(),s.offset);$('#eventClock').textContent=dateText(localNow,{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false,timeZone:'UTC'});$('#eventDate').textContent=dateText(localNow,{weekday:'long',day:'2-digit',month:'long',year:'numeric',timeZone:'UTC'});const visitorNow=new Date();$('#visitorClock').textContent=visitorNow.toLocaleTimeString(undefined,{hour12:false});$('#visitorDate').textContent=visitorNow.toLocaleDateString(undefined,{weekday:'long',day:'2-digit',month:'long',year:'numeric'});$('#visitorZone').textContent=Intl.DateTimeFormat().resolvedOptions().timeZone||'LOCAL';$('#raceKicker').textContent=`RACE CONTROL / ${s.country.toUpperCase()} · ${s.circuit.toUpperCase()}`;$('#liveTitle').textContent=s.event.toUpperCase();$('#factLength').textContent=s.name;$('#factLaps').textContent=s.localStart?dateText(shiftedDate(s.startsAt,s.offset),{hour:'2-digit',minute:'2-digit',timeZone:'UTC'}):'TBC';$('#factCorners').textContent=`UTC${s.offset.slice(0,6)}`;$('#factCircuit').textContent=s.circuit;}
async function updateLive(){try{const [c,serverSchedule]=await Promise.all([api('/api/public/config'),api('/api/race-control')]);let r=serverSchedule;if(r.unavailable){try{r=await window.APEX.openF1Schedule()}catch{}}raceControl=r;renderClock();broadcastConfig=c;renderBroadcast();$('#lastUpdated').textContent=`UPDATED ${new Date(r.updatedAt||Date.now()).toLocaleTimeString()}`;$('#scheduleUpdated').textContent=new Date(r.updatedAt||Date.now()).toLocaleTimeString();$('#refreshLabel').textContent=`RACE CONTROL · CHECKED ${new Date().toLocaleTimeString()}`}catch(e){$('#lastUpdated').textContent='RACE CONTROL SERVER UNAVAILABLE';$('#refreshLabel').textContent=e.message}}
updateLive();setInterval(updateLive,60000);
/* ---- Live timing tower -------------------------------------------------
   One row per car: position, gap to leader, interval, last lap, its three
   sector times, speed trap, the tyre fitted (compound, age, stint) and the
   pit stops. Purple marks a session best, green a personal best. */
const timingBody=$('#timingBody'),timingScroll=document.querySelector('.timing-scroll');
const COMPOUND_INITIAL={SOFT:'S',MEDIUM:'M',HARD:'H',INTERMEDIATE:'I',WET:'W'};

function fmtLap(t){if(t===null||t===undefined)return '—';const m=Math.floor(t/60);return m?`${m}:${(t-m*60).toFixed(3).padStart(6,'0')}`:t.toFixed(3)}
function fmtSector(t){return t===null||t===undefined||t===0?'—':t.toFixed(3)}
function same(a,b){return a!==null&&a!==undefined&&b!==null&&b!==undefined&&Math.abs(a-b)<0.0006}
function clock(dateish){const d=dateish?new Date(dateish):new Date();return Number.isNaN(d.getTime())?'—':d.toLocaleTimeString()}
function uniqueParts(list){const seen=new Set(),out=[];for(const raw of list){const value=String(raw||'').trim();if(!value)continue;const key=value.toLowerCase();if(seen.has(key))continue;seen.add(key);out.push(value)}return out}

function sectorClass(value,sessionBest,personalBest){
  if(value===null||value===undefined||value===0)return 'timing-none';
  if(same(value,sessionBest))return 'timing-fastest';
  if(personalBest!==null&&personalBest!==undefined&&value<=personalBest+0.0006)return 'timing-personal';
  return '';
}

function renderTiming(data){
  if(!data||!Array.isArray(data.drivers))throw new Error('The timing feed returned no cars.');
  const best=(data.highlights&&data.highlights.bestSectors)||{};
  const fastest=data.highlights&&data.highlights.fastestLap;
  timingFeed.cars=Array.isArray(data.drivers)?data.drivers.length:0;
  $('#timingSessionName').textContent=data.sessionName||'LATEST SESSION';
  const where=uniqueParts([data.sessionType,data.circuit,data.country,data.year]).join(' · ');
  const when=data.dateStart?`${new Date(data.dateStart).toLocaleDateString()} ${clock(data.dateStart)}`:'';
  $('#timingSessionMeta').textContent=[where||'OpenF1 live timing',when].filter(Boolean).join(' · ');

  const liveNow=Boolean(data.inSession&&!data.simulated);
  const chips=[liveNow
    ?'<span class="timing-chip is-live">● LIVE SESSION</span>'
    :data.inSession
      ?'<span class="timing-chip is-warn">● SESSION ON AIR · LIVE PLAN NEEDED</span>'
      :data.simulated
        ?'<span class="timing-chip is-warn">LAST SESSION · SAVED CLASSIFICATION</span>'
        :'<span class="timing-chip">LAST SESSION · FINAL</span>'];
  if(data.lap)chips.push(`<span class="timing-chip">LAP <b>${escapeHtml(String(data.lap))}</b></span>`);
  if(fastest)chips.push(`<span class="timing-chip">FASTEST LAP <b>${escapeHtml(fastest.code)}</b> ${fmtLap(fastest.time)}${fastest.lap?` · L${fastest.lap}`:''}</span>`);
  for(const key of ['s1','s2','s3']){
    const winner=best[key];
    if(winner)chips.push(`<span class="timing-chip">${key.toUpperCase()} <b>${escapeHtml(winner.code)}</b> ${fmtSector(winner.value)}</span>`);
  }
  const highlights=data.highlights||{};
  if(highlights.mostStops)chips.push(`<span class="timing-chip">MOST STOPS <b>${escapeHtml(highlights.mostStops.code)}</b> ×${highlights.mostStops.count}</span>`);
  if(highlights.compounds&&highlights.compounds.length)chips.push(`<span class="timing-chip">COMPOUNDS <b>${highlights.compounds.map(c=>COMPOUND_INITIAL[c]||c[0]).join(' ')}</b></span>`);
  chips.push(`<span class="timing-chip${data.simulated?' is-warn':''}">${escapeHtml(String(data.source||'OPENF1').toUpperCase())} · ${clock(data.updatedAt)}</span>`);
  $('#timingChips').innerHTML=chips.join('');

  const keep=timingScroll?timingScroll.scrollLeft:0;
  timingBody.innerHTML=data.drivers.map(d=>{
    const stint=d.tyre||null;
    const last=d.lastLap||null;
    const gap=d.gapToLeader===null?{text:'—',cls:'timing-none'}:{text:d.gapToLeader==='LEADER'?'LEADER':d.gapToLeader,cls:'timing-gap'};
    const interval=d.interval===null?{text:'—',cls:'timing-none'}:{text:d.interval,cls:''};
    const lastCls=!last||!last.time?'timing-none':(fastest&&same(last.time,fastest.time)?'timing-fastest':(d.bestLap&&same(last.time,d.bestLap.time)?'timing-personal':''));
    const cells=['s1','s2','s3'].map(key=>{
      const value=last?last[key]:null;
      const cls=sectorClass(value,best[key]&&best[key].value,d.bestSectors?d.bestSectors[key]:null);
      return `<td class="${cls}">${fmtSector(value)}</td>`;
    }).join('');
    const trap=last&&last.speedTrap?String(last.speedTrap):'—';
    const tyre=stint
      ? `<span class="timing-tyre" title="${escapeHtml(String(stint.compound||'unknown'))} · stint ${stint.stintNumber||'?'} of ${stint.stints||'?'} · fitted lap ${stint.fittedLap||'?'} · used ${escapeHtml((stint.used||[]).join(', ')||'—')}"><i class="tyre-dot ${COMPOUND_INITIAL[stint.compound]?'tyre-'+stint.compound:'tyre-UNKNOWN'}"></i>${COMPOUND_INITIAL[stint.compound]||'?'}</span>`
      : '<span class="timing-none">—</span>';
    const stop=(d.pits&&d.pits.last)||null;
    const stopSeconds=stop?(Number.isFinite(stop.stop)?stop.stop:(Number.isFinite(stop.lane)?stop.lane:null)):null;
    const stopNote=stop?`<span class="timing-sub" title="stopped on lap ${stop.lap===null||stop.lap===undefined?'?':stop.lap}${Number.isFinite(stop.lane)?` · ${stop.lane}s in the pit lane`:''}">${stopSeconds===null?'—':`${stopSeconds.toFixed(1)}s stop`}</span>`:'';
    const pit=d.pits&&d.pits.count?`${d.pits.count}${stopNote}`:'<span class="timing-none">—</span>';
    const bestNote=d.bestLap&&d.bestLap.time?`<span class="timing-sub ${fastest&&same(d.bestLap.time,fastest.time)?'timing-fastest':''}">BEST ${fmtLap(d.bestLap.time)}</span>`:'';
    const bar=d.teamColour?` style="background:${escapeHtml(d.teamColour)}"`:'';
    return `<tr class="${d.position===1?'timing-leader':''}"><td class="t-pos">${d.position===null?'—':String(d.position)}</td><td class="t-driver"><div class="timing-driver"><i class="timing-bar"${bar}></i><div class="timing-driver-meta"><span class="timing-code">${escapeHtml(d.code)}</span><small>${escapeHtml(d.name||'')}</small></div></div></td><td class="${gap.cls}">${escapeHtml(String(gap.text))}</td><td class="t-int ${interval.cls}">${escapeHtml(String(interval.text))}</td><td class="t-last ${lastCls}">${fmtLap(last&&last.time)}${bestNote}${last&&last.pitOut?'<span class="timing-sub">PIT OUT</span>':''}</td>${cells}<td class="t-trap ${trap==='—'?'timing-none':''}">${trap}</td><td class="t-tyre">${tyre}</td><td class="t-age ${stint?'':'timing-none'}"${stint?` title="tyre fitted on lap ${stint.fittedLap===null||stint.fittedLap===undefined?'?':stint.fittedLap} · stint ${stint.stintNumber||'?'} of ${stint.stints||'?'} · used so far ${escapeHtml((stint.used||[]).join(', ')||'—')}"`:''}>${stint?`${stint.ageLaps}L${stint.fittedLap!==null&&stint.fittedLap!==undefined?`<span class="timing-sub">L${stint.fittedLap}</span>`:''}`:'—'}</td><td class="t-pits">${pit}</td><td class="t-laps">${d.laps||'—'}</td></tr>`;
  }).join('');
  if(timingScroll)timingScroll.scrollLeft=keep;

  $('#timingLegend').innerHTML='<span class="legend-fastest"><i></i>SESSION BEST</span><span class="legend-personal"><i></i>PERSONAL BEST</span><span class="legend-plain"><i></i>NO TIME SET</span>';
  // The server sends one note as a string and several as an array; both have to
  // reach the page or the panel loses the explanation for the state it is in.
  const notes=(Array.isArray(data.notes)?data.notes:data.notes?[String(data.notes)]:[]).slice();
  if(data.simulated)notes.unshift('This tower is built from the saved classification rather than the live timing loop.');
  if(data.live&&data.simulated)notes.push('Reading a session in real time needs a paid OpenF1 plan, so the tower falls back to the last saved classification.');
  $('#timingNote').textContent=notes.join(' ');
  renderTimingSync();
}

/* ---- Team radio: the recordings plus their Whisper transcripts --------
   Each call can be listened to in place. The audio element lives outside the
   list because the list is rebuilt on every poll; the player remembers which
   call it is holding, so a re-render neither restarts nor drops playback. One
   call plays at a time — pressing another takes over. */
const radioAudio=document.createElement('audio');
radioAudio.preload='none';
const radioPlayer={id:null,url:null,loading:false,error:''};

function radioItemActive(id){return radioPlayer.id===String(id)}
function syncRadioButtons(){
  document.querySelectorAll('#radioList .radio-item').forEach(node=>{
    const button=node.querySelector('[data-play]');
    if(!button)return;
    const active=radioItemActive(node.dataset.call);
    const failed=active&&Boolean(radioPlayer.error);
    const loading=active&&radioPlayer.loading;
    const playing=active&&!failed&&!loading&&!radioAudio.paused&&!radioAudio.ended;
    node.classList.toggle('is-playing',playing);
    node.classList.toggle('is-loading',loading);
    button.setAttribute('aria-pressed',String(playing));
    button.disabled=loading;
    const icon=button.querySelector('.radio-play-icon'),label=button.querySelector('.radio-play-text');
    if(icon)icon.textContent=playing?'❚❚':'▶';
    if(label)label.textContent=failed?'RETRY':playing?'PAUSE':loading?'LOADING':'PLAY';
    const actions=node.querySelector('.radio-actions');
    let trouble=node.querySelector('.radio-play-error');
    if(failed&&actions){if(!trouble){trouble=document.createElement('span');trouble.className='radio-play-error';actions.appendChild(trouble)}trouble.textContent='CANNOT PLAY HERE · OPEN AT SOURCE'}
    else trouble?.remove();
  });
}
function stopRadio(){radioAudio.pause();radioPlayer.id=null;radioPlayer.url=null;radioPlayer.loading=false;radioPlayer.error='';try{radioAudio.removeAttribute('src');radioAudio.load()}catch{}syncRadioButtons()}
async function playRadioItem(id,url){
  if(radioItemActive(id)&&!radioAudio.paused){radioAudio.pause();return}
  if(radioPlayer.id&&!radioItemActive(id)){radioAudio.pause()}
  radioPlayer.id=String(id);radioPlayer.url=url;radioPlayer.error='';radioPlayer.loading=true;syncRadioButtons();
  if(radioAudio.getAttribute('src')!==url){radioAudio.src=url}
  try{await radioAudio.play()}catch(e){radioPlayer.error=String(e&&e.message||e||'playback failed')}
  radioPlayer.loading=false;syncRadioButtons();
}
radioAudio.addEventListener('pause',()=>{radioPlayer.loading=false;syncRadioButtons()});
radioAudio.addEventListener('playing',()=>{radioPlayer.error='';radioPlayer.loading=false;syncRadioButtons()});
radioAudio.addEventListener('ended',()=>{radioPlayer.loading=false;syncRadioButtons()});
radioAudio.addEventListener('error',()=>{if(!radioPlayer.id)return;radioPlayer.loading=false;radioPlayer.error='This call could not be played in the browser.';syncRadioButtons()});
$('#radioList')?.addEventListener('click',(event)=>{const button=event.target.closest('[data-play]');if(!button)return;playRadioItem(button.dataset.call,button.dataset.play)});

function renderRadio(data){
  const items=Array.isArray(data&&data.items)?data.items:[];
  const list=$('#radioList');
  $('#radioModel').textContent=String((data&&data.model)||'whisper').toUpperCase();
  const sessionName=data&&data.session&&data.session.name;
  // Live radio is the server's answer: the calls come from the real-time feed
  // while the session is on, and from OpenF1's archive afterwards.
  const live=Boolean(data&&data.live)||Boolean(timingFeed.data&&timingFeed.data.feed&&timingFeed.data.feed.connected);
  $('#radioSub').textContent=sessionName?`${sessionName.toUpperCase()} · ${live?'LIVE':'RECORDINGS'}`:'DRIVER ↔ PIT WALL · AI TRANSCRIPTS';
  const marker=$('#radioLive');
  if(marker){marker.className=`radio-live${live?' is-live':''}`;marker.textContent=live?'● LIVE':'○ LAST SESSION'}
  if(!items.length){
    const gapMessage=data&&data.error?String(data.error):'OpenF1 has published no team radio for this session yet. Recordings appear during a session and this panel fills in on its own.';
    list.innerHTML=`<div class="radio-empty">${escapeHtml(gapMessage)}</div>`;
  }else{
    list.innerHTML=items.map(item=>{
      const who=`${escapeHtml(item.code)}${item.name?` <span class="radio-team">${escapeHtml(item.name)}</span>`:''}`;
      const waiting=item.status==='pending'?'Transcribing this call…':item.status==='silent'?'No speech in this call — engine and pit-wall noise only.':item.status==='disabled'?'Transcription is switched off in Race Control.':'No transcript for this call yet.';
      const body=item.transcript?`<p class="radio-text">${escapeHtml(item.transcript)}</p>`:`<p class="radio-text is-pending">${escapeHtml(waiting)}</p>`;
      const bar=item.teamColour?` style="background:${escapeHtml(item.teamColour)}"`:'';
      const call=String(item.id||item.url||'');
      const playing=radioItemActive(call)&&!radioPlayer.error&&!radioPlayer.loading&&!radioAudio.paused&&!radioAudio.ended;
      return `<article class="radio-item${playing?' is-playing':''}" data-call="${escapeHtml(call)}"><div class="radio-item-top"><i class="radio-avatar"${bar}></i><span class="radio-who">${who}</span><span class="radio-time">${item.at?clock(item.at):''}</span></div>${body}<div class="radio-actions"><button class="radio-play" type="button" data-play="${escapeHtml(item.url)}" data-call="${escapeHtml(call)}" aria-pressed="${playing}" aria-label="Listen to this team radio call" title="Listen to this call"><span class="radio-play-icon" aria-hidden="true">${playing?'❚❚':'▶'}</span><span class="radio-play-text">${playing?'PAUSE':'PLAY'}</span></button><a class="radio-link" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">SOURCE ↗</a></div></article>`;
    }).join('');
  }
  // A call that scrolls out of the served window stops playing with it.
  if(radioPlayer.id&&!list.querySelector(`.radio-item[data-call="${String(radioPlayer.id).replace(/"/g,'')}"]`))stopRadio();
  syncRadioButtons();
  $('#radioNotice').textContent=String((data&&data.notice)||'');
  const state=[];
  if(data&&Number.isFinite(data.transcribed)&&Number.isFinite(data.available))state.push(`${data.transcribed}/${data.available} TRANSCRIBED`);
  if(data&&Number.isFinite(data.silent)&&data.silent>0)state.push(`${data.silent} WITH NO SPEECH`);
  if(data&&data.enabled===false)state.push('TRANSCRIPTION OFF');
  $('#radioState').textContent=state.join(' · ');
  $('#radioTranscribe').toggleAttribute('disabled',!data||data.enabled===false||!data.pending);
}

/* ---- The tower keeps itself current ----------------------------------
   Nothing here is behind a button. Every second the page asks the server for a
   tiny probe (the reading's fingerprint and freshness, a few dozen bytes) and
   only pulls the full tower when that fingerprint has moved. The server does
   the reading and its own caching, so a finished session is not re-scraped and
   a live one is re-read on a short timer. */
const timingFeed={loading:false,data:null,probe:null,signature:'',error:'',cars:0};

function secondsAgo(iso){const t=Date.parse(iso||'');return Number.isFinite(t)?Math.max(0,Math.round((Date.now()-t)/1000)):null}
function secondsUntil(iso){const t=Date.parse(iso||'');return Number.isFinite(t)?Math.max(0,Math.round((t-Date.now())/1000)):null}

// The freshness line ticks every second, so it says what is actually true: how
// old the reading is and when the next upstream one is due.
async function fetchTiming(){
  const data=await api('/api/live/timing');
  timingFeed.signature=String(data.revision||JSON.stringify(data));
  timingFeed.data=data;
  renderTiming(data);
}

async function loadTiming(){
  if(timingFeed.loading)return;
  timingFeed.loading=true;
  try{
    const probe=await api('/api/live/timing?probe=1');
    timingFeed.probe=probe;
    timingFeed.error='';
    // The moment the session goes on air (or comes off it) the server's state is
    // re-read, so the gate never lags behind the feed by its slow poll.
    if(lastProbeLive===null||Boolean(probe.inSession)!==lastProbeLive){lastProbeLive=Boolean(probe.inSession);loadState()}
    if(!timingFeed.data||String(probe.revision||'')!==timingFeed.signature)await fetchTiming();
  }catch(e){
    timingFeed.error=e.message;
    if(!timingFeed.data)timingBody.innerHTML=`<tr><td class="timing-empty" colspan="13">${escapeHtml(e.message)}</td></tr>`;
  }finally{
    timingFeed.loading=false;
    renderTimingSync();
    renderTimingGate();
  }
}

function renderTimingSync(){
  const chip=$('#timingSync'),source=$('#timingSource');
  const probe=timingFeed.probe,data=timingFeed.data;
  const stamp=probe||data;
  if(timingFeed.error&&!data){
    if(chip){chip.className='timing-sync is-error';chip.textContent='FEED UNAVAILABLE · RETRYING'}
    if(source)source.textContent='TIMING FEED UNAVAILABLE';
    return;
  }
  if(!stamp)return;
  const age=secondsAgo(stamp.refreshedAt||stamp.updatedAt);
  const due=secondsUntil(stamp.nextReadAt);
  const reading=Number.isFinite(stamp.cacheMs)?Math.round(stamp.cacheMs/1000):null;
  const live=Boolean(stamp.inSession&&!stamp.simulated);
  // A pushed feed is a different thing from a polled one, and the panel should
  // not describe them the same way: there is no "next read" when the data
  // arrives by itself.
  const feed=stamp.feed||null;
  const frame=feed&&Number.isFinite(feed.ageSeconds)?feed.ageSeconds:null;
  if(chip){
    chip.className='timing-sync'+(live?' is-live':'')+(timingFeed.error?' is-error':'');
    chip.textContent=timingFeed.error
      ?'RE-READ FAILED · SHOWING LAST READING'
      :feed&&feed.connected
        ?['● LIVE FEED',frame!==null?`FRAME ${frame}s AGO`:`FRAMES ${feed.frames||0}`,feed.reconnects?`RECONNECTED ×${feed.reconnects}`:null].filter(Boolean).join(' · ')
        :['AUTO · 1s',reading?`SOURCE READ EVERY ${reading}s`:null,age!==null?`DATA ${age}s OLD`:null].filter(Boolean).join(' · ');
  }
  if(source)source.textContent=(feed&&feed.connected
    ?['LIVE FEED',`${timingFeed.cars||0} CARS`,frame!==null?`FRAME ${frame}s AGO`:'—']
    :[live?'LIVE':stamp.simulated?'SAVED':'FINAL',`${timingFeed.cars||0} CARS`,age!==null?`READ ${age}s AGO`:'—',due!==null&&due>0?`NEXT READ ${due}s`:'READING NOW']).join(' · ');
}

/* ---- Live or not: the panel says which -------------------------------
   The server owns this answer (GET /api/live/state): it knows whether F1 is
   actually running a broadcast session, whether the real-time feed is attached,
   and when the next session starts. The page follows it instead of guessing
   from a timetable window, so the panel is live exactly when the session is. */
async function loadState(){
  const wasLive=Boolean(liveState&&liveState.live);
  try{
    liveState=await api('/api/live/state');
    feedError=String((liveState&&liveState.feed&&liveState.feed.error)||'');
  }catch(e){liveState=null}
  // The broadcast panel follows the same answer, so it goes on air with the
  // session and comes off it with the flag.
  renderBroadcast();
  // The moment the session goes on air (or comes off it) the radio panel is
  // re-read and its poll interval switched, so calls are not left waiting for
  // the between-sessions 45 second poll.
  if(Boolean(liveState&&liveState.live)!==wasLive){schedulePolling();loadRadio(true)}
}

function renderTimingGate(){
  const gate=$('#timingGate');
  if(!gate)return;
  const data=timingFeed.data,probe=timingFeed.probe,server=liveState;
  // Either the tower arrived from the real-time feed or the probe says the feed
  // is delivering: both mean there is nothing to gate off.
  const liveFeed=Boolean(data&&data.feed&&data.feed.connected)||Boolean(probe?probe.inSession&&!probe.simulated:data&&data.inSession&&!data.simulated);
  if(liveFeed){gate.hidden=true;return}
  const onAir=Boolean(server?server.live:(probe&&(probe.onAir||probe.inSession))||(data&&data.inSession));
  const scheduled=Boolean(raceControl&&raceControl.activeSession&&!onAir);
  const s=onAir
    ?((server&&(server.liveSession||server.session))||(probe&&probe.sessionName?{name:probe.sessionName}:null))
    :((server&&server.nextSession)||(raceControl&&(raceControl.nextSession||raceControl.activeSession))||null);
  gate.hidden=false;
  gate.classList.toggle('is-air',onAir);
  const state=$('#timingGateState'),where=$('#timingGateWhere'),event=$('#timingGateEvent'),count=$('#timingGateCount'),note=$('#timingGateNote');
  const label=x=>[String(x.event||'').toUpperCase(),String(x.name||'').toUpperCase()].filter(Boolean).join(' · ');
  const place=x=>[x.circuit,x.country].filter(Boolean).join(' · ');
  if(onAir){
    state.textContent='● SESSION ON AIR';
    where.textContent=s?place(s):'';
    event.textContent=s?label(s):'A SESSION IS UNDERWAY';
    count.innerHTML='<span class="timing-gate-cell"><b class="is-air">LIVE</b><i>ON TRACK NOW</i></span>';
    note.textContent=['The live feed has not sent a timing line yet — it hands over from the previous session a few seconds after the lights, and the running order below is still that last completed session.',feedError?`FEED: ${feedError}`:null,s&&s.kind?`SESSION KIND: ${String(s.kind).toUpperCase().replace(/-/g,' ')}`:null].filter(Boolean).join(' ');
    return;
  }
  if(!s){
    state.textContent='● NO SESSION SCHEDULED';
    where.textContent='';
    event.textContent='WAITING FOR THE NEXT RACE WEEKEND';
    count.innerHTML='<span class="timing-gate-cell"><b>—</b><i>NOT LISTED</i></span>';
    note.textContent='The tower below shows the most recent completed session. A countdown takes over here as soon as the season schedule is published.';
    return;
  }
  const left=Math.max(0,Math.floor((Date.parse(s.startsAt)-Date.now())/1000));
  state.textContent='● NEXT SESSION';
  where.textContent=place(s);
  event.textContent=label(s);
  const cells=[[Math.floor(left/86400),'DAYS'],[Math.floor(left%86400/3600),'HRS'],[Math.floor(left%3600/60),'MIN'],[left%60,'SEC']];
  count.innerHTML=cells.map(([n,label])=>`<span class="timing-gate-cell"><b>${String(n).padStart(2,'0')}</b><i>${label}</i></span>`).join('');
  note.textContent=[scheduled
    ?'A session is on track, but it is not one of the sessions this panel goes live for (free practice, sprint qualifying, sprint, qualifying and the race), so the countdown below is for the next one.'
    :'Practice, the qualifying sessions, the sprint and the race take this panel over the second they go on air — real running order, sector times, tyres, pit stops and team radio, with nothing to press.',
    'Until then the tower below is the last completed session.'].join(' ');
}

const radioFeed={loading:false,data:null,busy:false};
async function loadRadio(force){
  if(radioFeed.loading&&!force)return;
  radioFeed.loading=true;
  try{
    const data=await api('/api/live/radio');
    const wasLive=radioLive();
    radioFeed.data=data;
    renderRadio(data);
    // Going live (or coming off air) changes how often this panel is polled.
    if(radioLive()!==wasLive)schedulePolling();
    // A session keeps producing calls. Ask the server to transcribe the next
    // one; it serialises the work, so many open tabs still cost one AI call.
    if(data.enabled!==false&&data.pending>0&&!document.hidden)transcribeNext(false);
  }catch(e){
    $('#radioList').innerHTML=`<div class="radio-empty">${escapeHtml(e.message)}</div>`;
  }finally{radioFeed.loading=false}
}

async function transcribeNext(fromClick){
  if(radioFeed.busy)return;
  radioFeed.busy=true;
  $('#radioState').textContent='TRANSCRIBING…';
  $('#radioTranscribe').setAttribute('disabled','');
  try{
    const result=await api('/api/live/radio/transcribe',{method:'POST'});
    if(result.ok){
      $('#radioState').textContent=result.remaining>0?`${result.remaining} MORE CALLS QUEUED`:'ALL CALLS TRANSCRIBED';
      radioFeed.data=null;
      await loadRadio(true);
    }else{
      $('#radioState').textContent=String(result.reason||'idle').toUpperCase().replace(/-/g,' ');
      // A failed transcription is usually a transient provider error; say so
      // instead of leaving the panel showing a bare FAILED, and let the next
      // poll retry it.
      if(fromClick||result.reason==='failed')$('#radioNotice').textContent=String(result.message||'');
    }
  }catch(e){
    $('#radioState').textContent='TRANSCRIPTION FAILED';
    $('#radioNotice').textContent=e.message;
  }finally{
    radioFeed.busy=false;
    const data=radioFeed.data;
    $('#radioTranscribe').toggleAttribute('disabled',!data||data.enabled===false||!data.pending);
  }
}

$('#radioTranscribe')?.addEventListener('click',()=>transcribeNext(true));
let timingTimer=0,radioTimer=0,tickTimer=0;
// Every second: tick the clocks, then ask whether the tower has moved.
function tick(){
  renderClock();
  renderTimingGate();
  renderTimingSync();
}
let stateTimer=0;
function radioLive(){
  return Boolean(liveState&&liveState.live)
    ||Boolean(radioFeed.data&&radioFeed.data.live)
    ||Boolean(timingFeed.data&&timingFeed.data.feed&&timingFeed.data.feed.connected);
}
function schedulePolling(){
  clearInterval(timingTimer);
  clearInterval(radioTimer);
  clearInterval(tickTimer);
  clearInterval(stateTimer);
  if(document.hidden)return;
  tickTimer=setInterval(tick,1000);
  timingTimer=setInterval(loadTiming,1000);
  stateTimer=setInterval(loadState,20000);
  // Calls land during a session and should show up within seconds; between
  // sessions the panel changes rarely and each transcript is an AI call, so it
  // is asked about far less often.
  radioTimer=setInterval(()=>loadRadio(),radioLive()?15000:45000);
}
schedulePolling();
document.addEventListener('visibilitychange',()=>{
  if(document.hidden)schedulePolling();
  else{schedulePolling();loadTiming();loadRadio();loadState()}
});
loadState();
loadTiming();
loadRadio();
