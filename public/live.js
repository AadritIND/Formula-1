const {api,escapeHtml}=window.APEX;const screen=document.querySelector('#liveScreen');let raceControl=null;
const $=s=>document.querySelector(s);
// The operator-approved embed arrives only while the session is live, and it
// brings its own play, volume and fullscreen controls, so the 16:9 window is
// handed straight to the provider.
function mountBroadcast(url,label){const host=screen?.querySelector('.broadcast-frame');if(!host)return;const current=host.querySelector('iframe');if(!url){current?.remove();return}if(current&&current.dataset.source===url)return;current?.remove();const el=document.createElement('iframe');el.dataset.source=url;el.title=label||'Race broadcast';el.setAttribute('allow','autoplay; encrypted-media; picture-in-picture; fullscreen');el.setAttribute('referrerpolicy','strict-origin-when-cross-origin');el.src=url;host.insertAdjacentElement('afterbegin',el)}
function offsetMinutes(value){const m=String(value||'00:00:00').match(/^([+-]?\d{2}):(\d{2})/);return m?(Number(m[1])*60+Math.sign(Number(m[1])||1)*Number(m[2])):0}
function shiftedDate(iso,offset){return new Date(Date.parse(iso)+offsetMinutes(offset)*60000)}
function dateText(date,options={}){return new Intl.DateTimeFormat(undefined,{timeZone:'UTC',...options}).format(date)}
function eventTime(s,iso){return `${dateText(shiftedDate(iso,s.offset),{weekday:'long',day:'2-digit',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'})} · UTC${s.offset&&s.offset!=='00:00:00'?s.offset.slice(0,6):'+00:00'}`}
function renderClock(){if(!raceControl)return;const s=raceControl.activeSession||raceControl.nextSession,active=Boolean(raceControl.activeSession);const state=$('#sessionState'),countdown=$('#sessionCountdown');if(!s){state.className='status-pill complete';state.textContent='● SEASON BREAK';$('#sessionEvent').textContent='NO MORE SESSIONS THIS SEASON';$('#sessionName').textContent=raceControl.latestSession?`${raceControl.latestSession.event} · ${raceControl.latestSession.name}`:'No upcoming session published';$('#sessionWhere').textContent='No later session is listed in the season schedule.';countdown.innerHTML='<span>—</span><span>—</span><span>—</span><span>—</span>';$('#sessionHeadline').textContent='The chequered flag for this calendar.';$('#sessionDetail').textContent='Check back when the next season schedule is published.';$('#sessionWindow').textContent='No future session listed';$('#nextSessionCard').textContent='Season schedule complete';$('#nextSessionTime').textContent='No further sessions are currently listed';return}
const now=Date.now(),target=Date.parse(active?s.endsAt:s.startsAt),left=Math.max(0,Math.floor((target-now)/1000));state.className=`status-pill ${active?'live':'scheduled'}`;state.textContent=active?'● SESSION UNDERWAY':'● NEXT SESSION';$('#sessionEvent').textContent=s.event.toUpperCase();$('#sessionName').textContent=active?`${s.name} · IN PROGRESS`:`${s.name} STARTS IN`;$('#sessionWhere').textContent=`${s.circuit||'Circuit TBC'} · ${s.location||''}, ${s.country||''} · UTC${s.offset&&s.offset!=='00:00:00'?s.offset.slice(0,6):'+00:00'}`;$('#sessionHeadline').textContent=active?'The session is on.':'Stand by for lights out.';$('#sessionDetail').textContent=active?`${s.name} is scheduled to finish at the time below. Live timing and car telemetry are not displayed here.`:`${s.name} is the next session in the published ${s.event} weekend schedule.`;$('#sessionWindow').textContent=`${eventTime(s,s.startsAt)} — ${dateText(shiftedDate(s.endsAt,s.offset),{hour:'2-digit',minute:'2-digit',timeZone:'UTC'})}`;$('#nextSessionCard').textContent=`${s.event} · ${s.name}`;$('#nextSessionTime').textContent=eventTime(s,s.startsAt);const days=Math.floor(left/86400),hours=Math.floor(left%86400/3600),mins=Math.floor(left%3600/60),secs=left%60;countdown.innerHTML=[days,hours,mins,secs].map(n=>`<span>${String(n).padStart(2,'0')}</span>`).join('');const localNow=shiftedDate(new Date().toISOString(),s.offset);$('#eventClock').textContent=dateText(localNow,{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false,timeZone:'UTC'});$('#eventDate').textContent=dateText(localNow,{weekday:'long',day:'2-digit',month:'long',year:'numeric',timeZone:'UTC'});const visitorNow=new Date();$('#visitorClock').textContent=visitorNow.toLocaleTimeString(undefined,{hour12:false});$('#visitorDate').textContent=visitorNow.toLocaleDateString(undefined,{weekday:'long',day:'2-digit',month:'long',year:'numeric'});$('#visitorZone').textContent=Intl.DateTimeFormat().resolvedOptions().timeZone||'LOCAL';$('#raceKicker').textContent=`RACE CONTROL / ${s.country.toUpperCase()} · ${s.circuit.toUpperCase()}`;$('#liveTitle').textContent=s.event.toUpperCase();$('#factLength').textContent=s.name;$('#factLaps').textContent=s.localStart?dateText(shiftedDate(s.startsAt,s.offset),{hour:'2-digit',minute:'2-digit',timeZone:'UTC'}):'TBC';$('#factCorners').textContent=`UTC${s.offset.slice(0,6)}`;$('#factCircuit').textContent=s.circuit;}
async function updateLive(){try{const [c,serverSchedule]=await Promise.all([api('/api/public/config'),api('/api/race-control')]);let r=serverSchedule;if(r.unavailable){try{r=await window.APEX.openF1Schedule()}catch{}}raceControl=r;renderClock();const status=$('#statusPill'),live=c.status==='live'&&c.streamUrl;status.className=`status-pill ${live?'live':c.status==='complete'?'complete':'scheduled'}`;status.textContent=live?'● ON AIR':c.status==='complete'?'● SESSION COMPLETE':'● SCHEDULED';$('#lastUpdated').textContent=`UPDATED ${new Date(r.updatedAt||Date.now()).toLocaleTimeString()}`;$('#scheduleUpdated').textContent=new Date(r.updatedAt||Date.now()).toLocaleTimeString();$('#refreshLabel').textContent=`RACE CONTROL · CHECKED ${new Date().toLocaleTimeString()}`;screen.querySelector('.broadcast-lockup')?.toggleAttribute('hidden',live);screen.querySelector('.broadcast-corner')?.toggleAttribute('hidden',live);screen.querySelector('.broadcast-scan')?.toggleAttribute('hidden',live);screen.querySelector('.broadcast-corner').innerHTML=live?'APEX <span>LIVE</span>':'APEX <span>RACE CONTROL</span>';screen.querySelector('.broadcast-foot').innerHTML=live?`${escapeHtml(c.sessionLabel)} <span>OPERATOR EMBED</span>`:'STREAM WILL APPEAR HERE <span>OPERATOR-APPROVED EMBED</span>';mountBroadcast(live?c.streamUrl:'',c.sessionLabel)}catch(e){$('#lastUpdated').textContent='RACE CONTROL SERVER UNAVAILABLE';$('#refreshLabel').textContent=e.message}}
updateLive();setInterval(renderClock,1000);setInterval(updateLive,60000);
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
  $('#timingSessionName').textContent=data.sessionName||'LATEST SESSION';
  const where=uniqueParts([data.sessionType,data.circuit,data.country,data.year]).join(' · ');
  const when=data.dateStart?`${new Date(data.dateStart).toLocaleDateString()} ${clock(data.dateStart)}`:'';
  $('#timingSessionMeta').textContent=[where||'OpenF1 live timing',when].filter(Boolean).join(' · ');

  const chips=[data.live?'<span class="timing-chip is-live">● LIVE SESSION</span>':'<span class="timing-chip">SESSION COMPLETE</span>'];
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
  const notes=(Array.isArray(data.notes)?data.notes:[]).slice();
  if(data.simulated)notes.unshift('This tower is built from the saved classification rather than the live timing loop.');
  if(data.live&&data.simulated)notes.push('Reading a session in real time needs a paid OpenF1 plan, so the tower falls back to the last saved classification.');
  $('#timingNote').textContent=notes.join(' ');
  $('#timingSource').textContent=`${data.live?'LIVE':data.simulated?'SAVED':'FINAL'} · ${data.drivers.length} CARS · UPDATED ${clock(data.updatedAt)}`;
}

/* ---- Team radio: the recordings plus their Whisper transcripts -------- */
function renderRadio(data){
  const items=Array.isArray(data&&data.items)?data.items:[];
  const list=$('#radioList');
  $('#radioModel').textContent=String((data&&data.model)||'whisper').toUpperCase();
  const sessionName=data&&data.session&&data.session.name;
  $('#radioSub').textContent=sessionName?sessionName.toUpperCase():'DRIVER ↔ PIT WALL · AI TRANSCRIPTS';
  if(!items.length){
    const gapMessage=data&&data.error?String(data.error):'OpenF1 has published no team radio for this session yet. Recordings appear during a session and this panel fills in on its own.';
    list.innerHTML=`<div class="radio-empty">${escapeHtml(gapMessage)}</div>`;
  }else{
    list.innerHTML=items.map(item=>{
      const who=`${escapeHtml(item.code)}${item.name?` <span class="radio-team">${escapeHtml(item.name)}</span>`:''}`;
      const waiting=item.status==='pending'?'Transcribing this call…':item.status==='silent'?'No speech in this call — engine and pit-wall noise only.':item.status==='disabled'?'Transcription is switched off in Race Control.':'No transcript for this call yet.';
      const body=item.transcript?`<p class="radio-text">${escapeHtml(item.transcript)}</p>`:`<p class="radio-text is-pending">${escapeHtml(waiting)}</p>`;
      const bar=item.teamColour?` style="background:${escapeHtml(item.teamColour)}"`:'';
      return `<article class="radio-item"><div class="radio-item-top"><i class="radio-avatar"${bar}></i><span class="radio-who">${who}</span><span class="radio-time">${item.at?clock(item.at):''}</span></div>${body}<a class="radio-link" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">LISTEN AT SOURCE ↗</a></article>`;
    }).join('');
  }
  $('#radioNotice').textContent=String((data&&data.notice)||'');
  const state=[];
  if(data&&Number.isFinite(data.transcribed)&&Number.isFinite(data.available))state.push(`${data.transcribed}/${data.available} TRANSCRIBED`);
  if(data&&Number.isFinite(data.silent)&&data.silent>0)state.push(`${data.silent} WITH NO SPEECH`);
  if(data&&data.enabled===false)state.push('TRANSCRIPTION OFF');
  $('#radioState').textContent=state.join(' · ');
  $('#radioTranscribe').toggleAttribute('disabled',!data||data.enabled===false||!data.pending);
}

const timingFeed={loading:false,data:null};
async function loadTiming(force){
  if(timingFeed.loading)return;
  timingFeed.loading=true;
  try{
    if(!timingFeed.data)timingBody.innerHTML='<tr><td class="timing-empty" colspan="13">Reading the timing loop…</td></tr>';
    const data=await api(`/api/live/timing${force?'?refresh=1':''}`);
    timingFeed.data=data;
    renderTiming(data);
  }catch(e){
    if(!timingFeed.data)timingBody.innerHTML=`<tr><td class="timing-empty" colspan="13">${escapeHtml(e.message)}</td></tr>`;
    $('#timingSource').textContent='TIMING FEED UNAVAILABLE';
    $('#timingNote').textContent=e.message;
  }finally{timingFeed.loading=false}
}

const radioFeed={loading:false,data:null,busy:false};
async function loadRadio(force){
  if(radioFeed.loading&&!force)return;
  radioFeed.loading=true;
  try{
    const data=await api('/api/live/radio');
    radioFeed.data=data;
    renderRadio(data);
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

$('#timingRefresh')?.addEventListener('click',()=>loadTiming(true));
$('#radioTranscribe')?.addEventListener('click',()=>transcribeNext(true));
let timingTimer=0,radioTimer=0;
function schedulePolling(){
  clearInterval(timingTimer);
  clearInterval(radioTimer);
  if(document.hidden)return;
  timingTimer=setInterval(()=>loadTiming(false),30000);
  radioTimer=setInterval(()=>loadRadio(),45000);
}
schedulePolling();
document.addEventListener('visibilitychange',()=>{
  if(document.hidden)schedulePolling();
  else{schedulePolling();loadTiming(false);loadRadio()}
});
loadTiming();
loadRadio();
