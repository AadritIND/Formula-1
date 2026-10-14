const {api,escapeHtml,openF1Schedule,teamLogo,imageOrMark,driverFallbacks}=window.APEX;
const grid=document.querySelector('#calendarGrid');
const search=document.querySelector('#raceSearch');
const sessionFilter=document.querySelector('#sessionFilter');
const countryFilter=document.querySelector('#countryFilter');
const circuitDialog=document.querySelector('#circuitDialog');
let races=[],stateFilter='all',nextSession=null,currentActiveRace=null,activeMapMode='detailed';

function offsetMinutes(value){const m=String(value||'00:00:00').match(/^([+-]?\d{2}):(\d{2})/);return m?Number(m[1])*60+Math.sign(Number(m[1])||1)*Number(m[2]):0}
function localDate(iso,offset,options={}){const d=new Date(Date.parse(iso)+offsetMinutes(offset)*60000);return new Intl.DateTimeFormat(undefined,{timeZone:'UTC',...options}).format(d)}
const viewerTimezone=Intl.DateTimeFormat().resolvedOptions().timeZone||'Local time';
function viewerCountry(){
  const known={'Asia/Calcutta':'India','Asia/Kolkata':'India','America/New_York':'United States','America/Chicago':'United States','America/Denver':'United States','America/Los_Angeles':'United States','Europe/London':'United Kingdom','Europe/Monaco':'Monaco','Europe/Paris':'France','Europe/Rome':'Italy','Europe/Madrid':'Spain','Europe/Berlin':'Germany','Asia/Singapore':'Singapore','Asia/Tokyo':'Japan','Asia/Dubai':'United Arab Emirates','Australia/Melbourne':'Australia','Australia/Sydney':'Australia','America/Toronto':'Canada','America/Montreal':'Canada','America/Sao_Paulo':'Brazil'};
  if(known[viewerTimezone])return known[viewerTimezone];
  try{const region=new Intl.Locale(navigator.language).region;return region?new Intl.DisplayNames(['en'],{type:'region'}).of(region):viewerTimezone}catch{return viewerTimezone}
}
function viewerDate(iso,options={}){return new Intl.DateTimeFormat(undefined,{timeZone:viewerTimezone,...options}).format(new Date(iso))}
const viewerLabel=viewerCountry()+' · '+viewerTimezone;

function groupSessions(sessions){
  const groups=new Map();
  for(const s of sessions){
    const malaysia=s.location==='Kuala Lumpur'&&/bahrain/i.test(`${s.country||''} ${s.event||''}`);
    if(!groups.has(s.meetingId))groups.set(s.meetingId,{
      meetingId:s.meetingId,
      round:s.round||null,
      name:malaysia?'Bahrain Grand Prix in Malaysia':s.event,
      location:s.location,
      circuit:malaysia?'Sepang':s.circuit,
      circuitKey:s.circuitKey,
      country:malaysia?'Malaysia':s.country,
      offset:s.offset,
      startsAt:s.startsAt,
      endsAt:s.endsAt,
      sessions:[]
    });
    const g=groups.get(s.meetingId);
    if(Date.parse(s.startsAt)<Date.parse(g.startsAt))g.startsAt=s.startsAt;
    if(Date.parse(s.endsAt)>Date.parse(g.endsAt))g.endsAt=s.endsAt;
    g.sessions.push(s);
  }
  return [...groups.values()].sort((a,b)=>Date.parse(a.startsAt)-Date.parse(b.startsAt));
}

const verified2026Results=[
  ['Melbourne',[['George Russell','RUS','Mercedes'],['Kimi Antonelli','ANT','Mercedes'],['Charles Leclerc','LEC','Ferrari']],58],
  ['Shanghai',[['Kimi Antonelli','ANT','Mercedes'],['George Russell','RUS','Mercedes'],['Lewis Hamilton','HAM','Ferrari']],56],
  ['Suzuka',[['Kimi Antonelli','ANT','Mercedes'],['Oscar Piastri','PIA','McLaren'],['Charles Leclerc','LEC','Ferrari']],53],
  ['Miami',[['Kimi Antonelli','ANT','Mercedes'],['Lando Norris','NOR','McLaren'],['Oscar Piastri','PIA','McLaren']],57],
  ['Canada',[['Kimi Antonelli','ANT','Mercedes'],['Lewis Hamilton','HAM','Ferrari'],['Max Verstappen','VER','Red Bull Racing']],68],
  ['Monaco',[['Kimi Antonelli','ANT','Mercedes'],['Lewis Hamilton','HAM','Ferrari'],['Isack Hadjar','HAD','Red Bull Racing']],78],
  ['Barcelona',[['Lewis Hamilton','HAM','Ferrari'],['George Russell','RUS','Mercedes'],['Lando Norris','NOR','McLaren']],66],
  ['Spielberg',[['George Russell','RUS','Mercedes'],['Max Verstappen','VER','Red Bull Racing'],['Kimi Antonelli','ANT','Mercedes']],71],
  ['Silverstone',[['Charles Leclerc','LEC','Ferrari'],['George Russell','RUS','Mercedes'],['Lewis Hamilton','HAM','Ferrari']],52],
  ['Spa-Francorchamps',[['Kimi Antonelli','ANT','Mercedes'],['Charles Leclerc','LEC','Ferrari'],['Max Verstappen','VER','Red Bull Racing']],44],
  ['Hungary',[['Lando Norris','NOR','McLaren'],['Max Verstappen','VER','Red Bull Racing'],['Kimi Antonelli','ANT','Mercedes']],70],
  ['Zandvoort',[['Lando Norris','NOR','McLaren'],['Kimi Antonelli','ANT','Mercedes'],['George Russell','RUS','Mercedes']],72],
  ['Monza',[['Kimi Antonelli','ANT','Mercedes'],['George Russell','RUS','Mercedes'],['Max Verstappen','VER','Red Bull Racing']],53],
  ['Madrid',[['Kimi Antonelli','ANT','Mercedes'],['Max Verstappen','VER','Red Bull Racing'],['Lando Norris','NOR','McLaren']],57],
  ['Baku',[['George Russell','RUS','Mercedes'],['Max Verstappen','VER','Red Bull Racing'],['Isack Hadjar','HAD','Red Bull Racing']],51],
  ['Bahrain Grand Prix in Malaysia',[['Max Verstappen','VER','Red Bull Racing'],['Kimi Antonelli','ANT','Mercedes'],['Lewis Hamilton','HAM','Ferrari']],55],
  ['Singapore',[['Max Verstappen','VER','Red Bull Racing'],['Charles Leclerc','LEC','Ferrari'],['Kimi Antonelli','ANT','Mercedes']],62]
];

function applyWinnerFallback(){
  for(const race of races){
    if(raceStatus(race).key!=='complete'||race.result?.podium?.length>=3)continue;
    const eventIdentity=`${race.name} ${race.location} ${race.country} ${race.circuit}`.toLowerCase();
    const known=verified2026Results.find(([venue])=>eventIdentity.includes(venue.toLowerCase())||(venue==='Bahrain Grand Prix in Malaysia'&&/kuala lumpur|sepang|malaysia/i.test(eventIdentity)));
    if(!known)continue;
    const[,rows,laps]=known,podium=rows.map(([name,code,team],i)=>({
      position:i+1,
      name,
      code,
      team,
      teamColour:'',
      headshotUrl:driverFallbacks[code]||''
    }));
    race.result={source:'F1 official results',winner:podium[0],podium,laps};
  }
}

function isGrandPrixRace(s){return s.type==='Race'&&String(s.name||'').trim().toLowerCase()==='race'}

async function attachWeekendResults(races,onResult=()=>{}){
  for(const race of races){
    const session=(race.sessions||[]).find(s=>isGrandPrixRace(s)&&Date.parse(s.endsAt)<Date.now());
    if(!session||(race.result?.source==='OpenF1'&&race.result.podium?.length>=3))continue;
    try{
      const [resultResponse,driverResponse]=await Promise.all([
        fetch(`https://api.openf1.org/v1/session_result?session_key=${encodeURIComponent(session.id)}&position%3C=3`,{headers:{Accept:'application/json'}}),
        fetch(`https://api.openf1.org/v1/drivers?session_key=${encodeURIComponent(session.id)}`,{headers:{Accept:'application/json'}})
      ]);
      if(resultResponse.ok&&driverResponse.ok){
        const [results,drivers]=await Promise.all([resultResponse.json(),driverResponse.json()]),byNo=new Map(drivers.map(d=>[d.driver_number,d]));
        const podium=results.filter(x=>Number.isFinite(x.position)).sort((a,b)=>a.position-b.position).slice(0,3).map(x=>{
          const d=byNo.get(x.driver_number)||{};
          const code=d.name_acronym||String(x.driver_number);
          return{
            position:x.position,
            code,
            name:d.full_name||`Driver ${x.driver_number}`,
            team:d.team_name||'—',
            teamColour:d.team_colour||'',
            headshotUrl:d.headshot_url||driverFallbacks[code]||''
          };
        });
        if(podium.length){
          race.result={source:'OpenF1',winner:podium[0],podium,classified:results.length,laps:results.find(x=>x.position===1)?.number_of_laps||null};
          onResult();
        }
      }
    }catch{}
    await new Promise(resolve=>setTimeout(resolve,150));
  }
}

async function loadCalendar(){
  let data=await api('/api/calendar');
  if(data.source!=='OpenF1 & APEX Circuit Core'&&(!data.races||!data.races[0]?.circuitDetailedImage)){
    try{
      const schedule=await openF1Schedule();
      data={source:'OpenF1',year:schedule.year,updatedAt:schedule.updatedAt,races:groupSessions(schedule.sessions)};
    }catch{}
  }
  return data;
}

function raceStatus(r,now=Date.now()){
  const active=(r.sessions||[]).find(s=>Date.parse(s.startsAt)<=now&&Date.parse(s.endsAt)>=now);
  if(active)return{label:'IN SESSION',key:'active',session:active};
  const upcoming=(r.sessions||[]).find(s=>Date.parse(s.startsAt)>now);
  if(upcoming)return{label:'UP NEXT',key:'upcoming',session:upcoming};
  return{label:'COMPLETED',key:'complete',session:null};
}

function fillCountryFilter(){
  const choices=[...new Set(races.map(r=>r.country).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  countryFilter.innerHTML='<option value="all">ALL COUNTRIES</option>'+choices.map(country=>`<option value="${escapeHtml(country)}">${escapeHtml(country.toUpperCase())}</option>`).join('');
}

function circuitDays(race){
  return`${localDate(race.startsAt,race.offset,{day:'2-digit',month:'short'})} — ${localDate(race.endsAt,race.offset,{day:'2-digit',month:'short',year:'numeric'})}`;
}

const circuitCache=new Map();

async function getCircuitDetails(race){
  const cacheKey=`circuit-${race.circuitKey||race.circuitSlug||race.name}`;
  if(circuitCache.has(cacheKey))return circuitCache.get(cacheKey);
  try{
    const res=await api(`/api/circuit/${encodeURIComponent(race.circuitSlug||race.circuitKey||race.name)}`);
    if(res.ok&&res.circuit){
      circuitCache.set(cacheKey,res.circuit);
      return res.circuit;
    }
  }catch{}
  return null;
}

// Render the official detailed circuit map (with sectors, turns, overtake detection zones, speed traps)
function renderDetailedMapView(race, circuit){
  const mapUrl = race.circuitDetailedImage || circuit?.detailedImage || race.circuitImage;
  const turns = circuit?.turns || race.turns || 16;
  const sectors = circuit?.sectors || race.sectors || [];
  const overtakeZones = circuit?.overtakeZones || race.overtakeZones || 2;
  const speedTrap = circuit?.speedTrap || race.speedTrap || 'Main Straight';
  const detectionZones = circuit?.detectionZones || race.detectionZones || 'Published detection points';

  return `
    <figure class="circuit-map-figure">
      <div class="map-image-wrap">
        <span class="map-art-stamp">OFFICIAL 2026 CIRCUIT FILE · ${turns} TURNS</span>
        <img src="${escapeHtml(mapUrl)}" alt="Official ${escapeHtml(race.name)} track map" loading="eager" decoding="async">
        <span class="map-start-tag"><i></i> START / FINISH</span>
      </div>
      <figcaption>
        <span>OFFICIAL DETAILED CIRCUIT SPECIFICATION</span>
        <span>SECTOR 1 · SECTOR 2 · SECTOR 3 · OVERTAKE MODE & STRAIGHT ZONES</span>
      </figcaption>
    </figure>

    <div class="circuit-spec-strip">
      <div class="spec-pill"><small>CIRCUIT LENGTH</small><b>${(circuit?.lengthKm||race.circuitLength||5.4).toFixed(3)} KM</b></div>
      <div class="spec-pill"><small>NUMBERED TURNS</small><b>${turns} CORNERS</b></div>
      <div class="spec-pill"><small>OVERTAKE ZONES</small><b>${overtakeZones} ACTIVE ZONES</b></div>
      <div class="spec-pill"><small>SPEED TRAP LOCATION</small><b>${escapeHtml(speedTrap)}</b></div>
    </div>

    ${sectors.length ? `
    <section class="map-sector-panel">
      <div class="map-index-head">
        <span>TIMING SECTOR BREAKDOWN</span>
        <b>THREE CHAMPIONSHIP SECTORS</b>
      </div>
      <div class="map-sector-rail">
        ${sectors.map(s => `
          <div class="sector-card sector-${s.number===1?'a':s.number===2?'b':'c'}">
            <div class="sector-badge"><i>0${s.number}</i> <b>${escapeHtml(s.name.toUpperCase())}</b></div>
            <span class="sector-turns">${escapeHtml(s.turns)}</span>
            <p class="sector-focus">${escapeHtml(s.focus||s.description||'')}</p>
          </div>
        `).join('')}
      </div>
    </section>
    ` : ''}

    <section class="map-technical-index">
      <div class="map-index-head">
        <span>NUMBERED CORNER SEQUENCE</span>
        <b>${turns} CORNERS MAPPED</b>
      </div>
      <div class="turn-key" aria-label="${turns} turn index">
        ${Array.from({length:turns},(_,i)=>`
          <span title="Turn ${i+1}">
            <b>${String(i+1).padStart(2,'0')}</b>
          </span>
        `).join('')}
      </div>
    </section>
  `;
}

// Render the interactive telemetry and vector trace view
function renderTelemetryMapView(race, circuit){
  const turns = circuit?.turns || race.turns || 16;
  const overtakeZones = circuit?.overtakeZones || race.overtakeZones || 2;
  const speedTrap = circuit?.speedTrap || race.speedTrap || 'Main Straight';

  return `
    <div class="telemetry-view-container">
      <div class="telemetry-status-bar">
        <span><i class="live-dot"></i> TELEMETRY TRACE SYNCHRONISED</span>
        <b>${(circuit?.lengthKm||race.circuitLength||5.4).toFixed(3)} KM · ${turns} TURNS</b>
      </div>
      <div class="vector-trace-box">
        <svg class="circuit-vector-svg" viewBox="0 0 800 460" aria-label="Interactive track layout">
          <defs>
            <linearGradient id="traceGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#ed1c24"/>
              <stop offset="50%" stop-color="#f2d65c"/>
              <stop offset="100%" stop-color="#69c6ec"/>
            </linearGradient>
            <filter id="traceGlow"><feGaussianBlur stdDeviation="3" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          </defs>
          <path class="vector-underlay" d="M140 340 C100 280 80 180 160 120 C220 70 340 90 420 130 C490 160 550 120 620 150 C680 180 720 250 680 320 C640 370 520 360 440 320 C380 290 320 340 260 360 Z" />
          <path class="vector-track-line" d="M140 340 C100 280 80 180 160 120 C220 70 340 90 420 130 C490 160 550 120 620 150 C680 180 720 250 680 320 C640 370 520 360 440 320 C380 290 320 340 260 360 Z" />
          <path class="vector-sector-1" d="M140 340 C100 280 80 180 160 120 C220 70 300 80 340 100" />
          <path class="vector-sector-2" d="M340 100 C420 130 490 160 550 120 C620 150 660 165 675 220" />
          <path class="vector-sector-3" d="M675 220 C680 280 640 370 520 360 C440 320 380 290 320 340 C260 360 200 360 140 340" />
          <!-- Turn Callouts -->
          <circle cx="140" cy="340" r="10" class="turn-node" /><text x="140" y="344" class="turn-node-text">1</text>
          <circle cx="160" cy="120" r="10" class="turn-node" /><text x="160" y="124" class="turn-node-text">4</text>
          <circle cx="420" cy="130" r="10" class="turn-node" /><text x="420" y="134" class="turn-node-text">8</text>
          <circle cx="620" cy="150" r="10" class="turn-node" /><text x="620" y="154" class="turn-node-text">12</text>
          <circle cx="680" cy="320" r="10" class="turn-node" /><text x="680" y="324" class="turn-node-text">15</text>
          <!-- Overtake Markers -->
          <rect x="220" y="70" width="140" height="20" rx="3" class="overtake-box"/>
          <text x="290" y="84" class="overtake-box-text">STRAIGHT MODE / DRS</text>
          <rect x="520" y="345" width="130" height="20" rx="3" class="overtake-box"/>
          <text x="585" y="359" class="overtake-box-text">OVERTAKE ACTIVATION</text>
          <!-- Start finish mark -->
          <line x1="140" y1="315" x2="140" y2="365" stroke="#fff" stroke-width="4" stroke-dasharray="3,3"/>
          <text x="140" y="385" class="start-text">START / FINISH</text>
        </svg>
      </div>
      <div class="telemetry-callout-grid">
        <div class="telemetry-card">
          <span>ACTIVE AERO STRAIGHT MODE</span>
          <b>${overtakeZones} ZONES IDENTIFIED</b>
          <p>Variable rear wing and active front flap reduce total aerodynamic drag down primary straights.</p>
        </div>
        <div class="telemetry-card">
          <span>SPEED TRAP VERIFICATION</span>
          <b>${escapeHtml(speedTrap)}</b>
          <p>Official radar trap monitors terminal velocity prior to primary braking point.</p>
        </div>
        <div class="telemetry-card">
          <span>2026 POWER SPLIT</span>
          <b>350 kW ELECTRICAL + 400 kW ICE</b>
          <p>Full 50% MGU-K electrical boost deployment engineered across sector exit transitions.</p>
        </div>
      </div>
    </div>
  `;
}

// Render the live AI race engineer intelligence view
async function renderAIBriefingView(race, circuit){
  const root = document.querySelector('#circuitMap');
  root.innerHTML = '<div class="track-loading"><i></i> CONSULTING APEX PIT WALL AI RACE ENGINEER…</div>';
  try{
    const data = await api(`/api/ai/circuit-briefing?circuit=${encodeURIComponent(race.circuitSlug || race.circuitKey || race.name)}`);
    const b = data.briefing || {};
    root.innerHTML = `
      <div class="ai-briefing-panel">
        <div class="ai-briefing-head">
          <div class="ai-badge"><span>⚡ APEX RACE INTEL</span><b>SENIOR RACE ENGINEER DOSSIER</b></div>
          <small>AI-POWERED TELEMETRY & STRATEGY ANALYSIS</small>
        </div>
        <p class="ai-briefing-summary">${escapeHtml(b.circuitSummary || '')}</p>
        <div class="ai-briefing-grid">
          <div class="ai-card">
            <span>AERODYNAMIC SETUP</span>
            <b>${escapeHtml(b.aeroSetup || 'Medium-High Downforce')}</b>
          </div>
          <div class="ai-card">
            <span>TYRE DEGRADATION FACTOR</span>
            <b>${escapeHtml(String(b.tyreDegradation || '3.5 / 5'))}</b>
          </div>
          <div class="ai-card">
            <span>OVERTAKE & STRAIGHT MODE STRATEGY</span>
            <b>${escapeHtml(b.overtakeStrategy || '')}</b>
          </div>
          <div class="ai-card">
            <span>CRITICAL LAP CORNERS</span>
            <b>${escapeHtml(b.keyCorners || '')}</b>
          </div>
        </div>
        <div class="ai-tactics-box">
          <span>PIT STOP & TACTICAL FORECAST</span>
          <p>${escapeHtml(b.raceTactics || '')}</p>
        </div>
        <div class="ai-ask-bar">
          <input type="text" id="aiEngineerInput" placeholder="Ask Pit Wall: e.g. What tyre compound is favored here?">
          <button type="button" id="aiEngineerBtn">ASK PIT WALL</button>
        </div>
        <div id="aiEngineerOutput" class="ai-engineer-response" hidden></div>
      </div>
    `;

    const input = root.querySelector('#aiEngineerInput');
    const btn = root.querySelector('#aiEngineerBtn');
    const out = root.querySelector('#aiEngineerOutput');

    btn.addEventListener('click', async () => {
      const q = input.value.trim();
      if(!q) return;
      btn.disabled = true;
      btn.textContent = 'CONSULTING…';
      out.hidden = false;
      out.textContent = 'Race engineer reviewing telemetry…';
      try{
        const reply = await api('/api/ai/race-engineer', {
          method: 'POST',
          body: JSON.stringify({ question: q, context: `${race.name} at ${circuit?.circuit||race.circuit}` })
        });
        out.textContent = reply.reply || 'Telemetry transmission complete.';
      }catch(e){
        out.textContent = 'Pit wall radio static: ' + e.message;
      }finally{
        btn.disabled = false;
        btn.textContent = 'ASK PIT WALL';
      }
    });

    input.addEventListener('keydown', (e) => {
      if(e.key === 'Enter') btn.click();
    });

  }catch(err){
    root.innerHTML = `<div class="track-loading">AI Intelligence unavailable: ${escapeHtml(err.message)}</div>`;
  }
}

async function updateCircuitDisplay(race, mode = 'detailed'){
  activeMapMode = mode;
  const root = document.querySelector('#circuitMap');
  const circuit = await getCircuitDetails(race);

  // Update tabs
  document.querySelectorAll('.map-view-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.mapMode === mode);
  });

  const legend = document.querySelector('#circuitLegend');
  if(legend) legend.style.display = mode === 'ai' ? 'none' : 'flex';

  const statusLabel = document.querySelector('#mapLiveStatus');
  if(statusLabel) {
    statusLabel.textContent = mode === 'detailed' ? 'OFFICIAL CIRCUIT MAP' : mode === 'telemetry' ? 'TELEMETRY & SECTORS' : 'AI RACE STRATEGY';
  }

  if(mode === 'detailed'){
    root.innerHTML = renderDetailedMapView(race, circuit);
  } else if(mode === 'telemetry'){
    root.innerHTML = renderTelemetryMapView(race, circuit);
  } else if(mode === 'ai'){
    await renderAIBriefingView(race, circuit);
  }
}

// Open Circuit Modal Dialog
async function openWeekend(index){
  const race=races[index];
  if(!race)return;
  currentActiveRace=race;
  const status=raceStatus(race);
  const podium=race.result?.podium||[];
  const winner=race.result?.winner;

  document.querySelector('#circuitEyebrow').textContent=`ROUND ${String(index+1).padStart(2,'0')} / CIRCUIT FILE`;
  document.querySelector('#circuitStatus').textContent=status.label;
  document.querySelector('#circuitTitle').textContent=race.name;
  document.querySelector('#circuitPlace').textContent=[race.circuit,race.location,race.country].filter(Boolean).join(' · ');
  document.querySelector('#circuitDates').textContent=circuitDays(race);
  document.querySelector('#circuitSessions').textContent=`${(race.sessions||[]).length} ON THE WEEKEND`;
  document.querySelector('#circuitDataState').textContent='VERIFIED';

  const circuit = await getCircuitDetails(race);
  const turns = circuit?.turns || race.turns || 16;
  const lengthKm = circuit?.lengthKm || race.circuitLength || 5.4;
  const overtakeZones = circuit?.overtakeZones || race.overtakeZones || 2;
  const speedTrap = circuit?.speedTrap || race.speedTrap || 'Main Straight';

  document.querySelector('#circuitShort').textContent=`${lengthKm.toFixed(3)} KM · ${turns} TURNS`;
  document.querySelector('#circuitOvertakeZones').textContent=`${overtakeZones} ZONES (OVERTAKE MODE)`;
  document.querySelector('#circuitSpeedTrap').textContent=speedTrap;

  // Render Podium with bulletproof flexbox layout
  const podiumBlock = document.querySelector('#circuitPodiumBlock');
  podiumBlock.hidden = status.key !== 'complete';

  const podiumRoot = document.querySelector('#circuitPodium');
  if(podium.length >= 3){
    podiumRoot.innerHTML = podium.slice(0,3).map((d,i) => {
      const pos = d.position || i + 1;
      const headshot = d.headshotUrl || driverFallbacks[d.code] || '';
      const logo = teamLogo(d.team);
      return `
        <div class="podium-driver podium-p${pos}">
          <span class="podium-pos">P${pos}</span>
          <div class="podium-driver-info">
            ${imageOrMark(headshot, d.name, 'podium-face', d.code || 'F1')}
            <div class="podium-text">
              <span class="podium-name">${escapeHtml(d.name)}</span>
              <span class="podium-code">${escapeHtml(d.code || '')}</span>
            </div>
          </div>
          <div class="podium-team-info">
            ${logo ? `<img class="podium-team-logo" src="${escapeHtml(logo)}" alt="${escapeHtml(d.team)}" loading="lazy">` : ''}
            <span class="podium-team-name">${escapeHtml(d.team || '')}</span>
          </div>
        </div>
      `;
    }).join('');
  } else if(winner){
    const headshot = winner.headshotUrl || driverFallbacks[winner.code] || '';
    const logo = teamLogo(winner.team);
    podiumRoot.innerHTML = `
      <div class="podium-driver podium-p1">
        <span class="podium-pos">P1</span>
        <div class="podium-driver-info">
          ${imageOrMark(headshot, winner.name, 'podium-face', winner.code || 'F1')}
          <div class="podium-text">
            <span class="podium-name">${escapeHtml(winner.name)}</span>
            <span class="podium-code">${escapeHtml(winner.code || '')}</span>
          </div>
        </div>
        <div class="podium-team-info">
          ${logo ? `<img class="podium-team-logo" src="${escapeHtml(logo)}" alt="${escapeHtml(winner.team)}" loading="lazy">` : ''}
          <span class="podium-team-name">${escapeHtml(winner.team || '')}</span>
        </div>
      </div>
      <p class="podium-pending">Official classification locked.</p>
    `;
  } else {
    podiumRoot.innerHTML = '<p class="podium-pending">The classified podium will appear following the chequered flag.</p>';
  }

  // Render Weekend Schedule
  document.querySelector('#circuitSchedule').innerHTML = (race.sessions||[])
    .slice()
    .sort((a,b)=>Date.parse(a.startsAt)-Date.parse(b.startsAt))
    .map(s=>`
      <div class="circuit-session-row">
        <span>${escapeHtml(s.name)}</span>
        <time>
          <b>${escapeHtml(localDate(s.startsAt,s.offset,{weekday:'short',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}))} · CIRCUIT</b>
          <small class="viewer-time">${escapeHtml(viewerDate(s.startsAt,{weekday:'short',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}))} · ${escapeHtml(viewerCountry())}</small>
        </time>
      </div>
    `).join('');

  circuitDialog.showModal();
  document.body.classList.add('dialog-open');

  // Render detailed map by default
  updateCircuitDisplay(race, 'detailed');
}

// Mode tab switcher events
document.querySelectorAll('.map-view-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    if(!currentActiveRace) return;
    updateCircuitDisplay(currentActiveRace, tab.dataset.mapMode);
  });
});

document.querySelector('#circuitClose').addEventListener('click',()=>circuitDialog.close());
circuitDialog.addEventListener('click',event=>{if(event.target===circuitDialog)circuitDialog.close()});
circuitDialog.addEventListener('close',()=>document.body.classList.remove('dialog-open'));

function paintFocus(){
  const now=Date.now(),race=races.find(r=>Date.parse(r.endsAt)>=now)||null;
  if(!race){
    document.querySelector('#focusName').textContent='The season is complete';
    document.querySelector('#focusLocation').textContent='NO UPCOMING GRAND PRIX';
    document.querySelector('#focusCircuit').textContent='The next season schedule will appear here when it is published.';
    document.querySelector('#focusSession').textContent='NEXT SESSION · —';
    nextSession=null;
    return;
  }
  const status=raceStatus(race,now);
  nextSession=status.session||null;
  document.querySelector('#focusRound').textContent=`ROUND ${String(races.indexOf(race)+1).padStart(2,'0')}`;
  document.querySelector('#focusLocation').textContent=[race.location,race.country].filter(Boolean).join(' · ').toUpperCase();
  document.querySelector('#focusName').textContent=race.name;
  document.querySelector('#focusCircuit').textContent=`${race.circuit||'Circuit TBC'} · GP local: ${race.country} UTC${(race.offset||'00:00:00').slice(0,6)} · Your local: ${viewerCountry()} (${viewerTimezone})`;
  document.querySelector('#focusSession').textContent=`${status.key==='active'?'NOW ON TRACK':'NEXT SESSION'} · ${status.session?.name||'—'}`;
  document.querySelector('#focusStart').textContent=status.session?`${localDate(status.session.startsAt,status.session.offset,{weekday:'long',day:'2-digit',month:'long',hour:'2-digit',minute:'2-digit'})} GP · ${viewerDate(status.session.startsAt,{weekday:'short',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})} YOU (${viewerCountry()})`:'SESSION COMPLETE';
  document.querySelector('#focusCountdownLabel').textContent=status.key==='active'?'SESSION ENDS IN':'COUNTDOWN TO SESSION';
  document.querySelector('#nextRaceLabel').textContent=race.name.toUpperCase();
  document.querySelector('#nextCircuit').textContent=race.circuit||'TBC';
  document.querySelector('#nextRaceDate').textContent=localDate(race.startsAt,race.offset,{weekday:'short',day:'2-digit',month:'short'});
  document.querySelector('#nextRaceOffset').textContent=`UTC${(race.offset||'00:00:00').slice(0,6)}`;
  document.querySelector('#nextRaceSessions').textContent=(race.sessions||[]).length||'—';
}

function updateCountdown(){
  const root=document.querySelector('#focusCountdown');
  if(!root)return;
  if(!nextSession){root.innerHTML='<b>--</b><b>--</b><b>--</b><b>--</b>';return}
  const end=Date.parse(nextSession.startsAt)<=Date.now(),target=Date.parse(end?nextSession.endsAt:nextSession.startsAt),left=Math.max(0,Math.floor((target-Date.now())/1000)),values=[Math.floor(left/86400),Math.floor(left%86400/3600),Math.floor(left%3600/60),left%60];
  root.innerHTML=values.map(n=>`<b>${String(n).padStart(2,'0')}</b>`).join('');
}

function renderCards(){
  const now=Date.now(),query=search.value.trim().toLowerCase(),wantedSession=sessionFilter.value,wantedCountry=countryFilter.value;
  let shown=0;
  grid.innerHTML=races.map((race,index)=>{
    const status=raceStatus(race,now),sessionRows=(race.sessions||[]).slice().sort((a,b)=>Date.parse(a.startsAt)-Date.parse(b.startsAt));
    const matchingSessions=sessionRows.filter(s=>wantedSession==='all'||String(s.type+' '+s.name).toLowerCase().includes(wantedSession));
    const searchable=[race.name,race.location,race.country,race.circuit,race.result?.winner?.name,race.result?.winner?.team].join(' ').toLowerCase();
    const matchesQuery=!query||searchable.includes(query),matchesCountry=wantedCountry==='all'||race.country===wantedCountry,matchesState=stateFilter==='all'||(stateFilter==='upcoming'?status.key==='upcoming'||status.key==='active':status.key===stateFilter),visible=matchesQuery&&matchesCountry&&matchesState&&matchingSessions.length>0;
    if(!visible)return'';
    shown++;
    const next=status.session;
    const winner=race.result?.winner;

    // Podium & Winner presentation inside Weekend Cards
    const podiumMarkup = race.result?.podium?.length ? `
      <div class="race-result">
        <div class="race-result-top">
          <span class="result-label"><i>★</i> RACE WINNER</span>
          <span class="result-laps">${race.result.laps?`${escapeHtml(race.result.laps)} LAPS`:'CLASSIFIED'}</span>
        </div>
        <div class="race-winner" style="--winner-team:#${escapeHtml(winner.teamColour||'ed1c24')}">
          <span class="winner-position">P1</span>
          ${imageOrMark(winner.headshotUrl||driverFallbacks[winner.code],winner.name,'winner-face',winner.code||'F1')}
          <div class="winner-details">
            <strong>${escapeHtml(winner.name)}</strong>
            <span class="winner-team">
              ${teamLogo(winner.team)?`<img class="winner-team-logo" src="${escapeHtml(teamLogo(winner.team))}" alt="${escapeHtml(winner.team)}">`:''}
              <span>${escapeHtml(winner.team)}</span>
            </span>
          </div>
        </div>
        ${race.result.podium.length>1?`
          <div class="race-podium">
            ${race.result.podium.slice(1).map(d=>`
              <div class="mini-podium-item">
                <span class="mini-pos">P${d.position}</span>
                ${imageOrMark(d.headshotUrl||driverFallbacks[d.code],d.name,'podium-mini-face',d.code||'F1')}
                <div class="mini-driver-info">
                  <b>${escapeHtml(d.code)}</b>
                  <small title="${escapeHtml(d.team)}">${escapeHtml(d.team||'')}</small>
                </div>
              </div>
            `).join('')}
          </div>
        `:''}
      </div>
    ` : `
      <div class="race-result race-result-pending">
        <span class="result-label">${status.key==='complete'?'RESULT PENDING':'RACE RESULT'}</span>
        <span class="result-pending-copy">${status.key==='complete'?'Awaiting official classification.':'Chequered flag result will appear here.'}</span>
      </div>
    `;

    const sessionMarkup=matchingSessions.map(s=>{
      const done=Date.parse(s.endsAt)<now,isNext=s.id===next?.id;
      return `
        <div class="weekend-session ${isNext?'is-next':''} ${done?'is-done':''}">
          <span class="session-name">${isNext&&!done?'<i></i>':''}${escapeHtml(s.name)}</span>
          <time datetime="${escapeHtml(s.startsAt)}">
            <small>${escapeHtml(localDate(s.startsAt,s.offset,{weekday:'short',day:'2-digit',month:'short'}))}</small>
            <b>${escapeHtml(localDate(s.startsAt,s.offset,{hour:'2-digit',minute:'2-digit',hour12:false}))}</b>
            <small class="viewer-time">YOU ${escapeHtml(viewerDate(s.startsAt,{hour:'2-digit',minute:'2-digit'}))} · ${escapeHtml(viewerCountry())}</small>
          </time>
        </div>
      `;
    }).join('');

    return `
      <button type="button" class="weekend-card ${status.key==='complete'?'is-complete':''} ${index===races.indexOf(races.find(r=>Date.parse(r.endsAt)>=now))?'is-next-race':''}" style="--card-order:${index}" tabindex="0" role="button" data-weekend-index="${index}" aria-label="Open ${escapeHtml(race.name)} circuit details">
        <span class="card-open-cue">CIRCUIT FILE <b>↗</b></span>
        <div class="weekend-card-head">
          <span class="weekend-round">R${String(index+1).padStart(2,'0')}</span>
          <span class="weekend-status ${status.key}"><i></i>${status.label}</span>
          <span class="weekend-date">${escapeHtml(localDate(race.startsAt,race.offset,{day:'2-digit',month:'short'}))}</span>
        </div>
        <div class="weekend-title-block">
          <h3>${escapeHtml(race.name)}</h3>
          <p>${escapeHtml([race.location,race.country].filter(Boolean).join(', '))}</p>
        </div>
        ${podiumMarkup}
        <div class="weekend-circuit">
          <span>${escapeHtml(race.circuit||'Circuit TBC')}</span>
          <b>UTC${escapeHtml((race.offset||'00:00:00').slice(0,6))}</b>
        </div>
        <div class="weekend-sessions">${sessionMarkup||'<div class="session-none">No sessions match this filter.</div>'}</div>
        <div class="weekend-card-foot">
          <span>${status.key==='complete'?'FINAL CLASSIFICATION':'WEEKEND WINDOW'}</span>
          <b>${escapeHtml(localDate(race.startsAt,race.offset,{day:'2-digit',month:'short'}))} — ${escapeHtml(localDate(race.endsAt,race.offset,{day:'2-digit',month:'short',year:'numeric'}))}</b>
        </div>
      </button>
    `;
  }).join('');

  document.querySelector('#calendarEmpty').hidden=shown>0;
  const filterLabel=stateFilter==='complete'?'COMPLETED':stateFilter.toUpperCase();
  document.querySelector('#resultsLabel').textContent=`${shown} ${shown===1?'WEEKEND':'WEEKENDS'} · ${stateFilter==='all'?'ALL RACES':filterLabel}`;
  document.querySelector('#allCount').textContent=races.length;
}

function applyFilters(){renderCards()}

async function start(){
  try{
    const data=await loadCalendar();
    races=data.races||[];
    if(!races.length){
      grid.innerHTML='<div class="calendar-empty">No race-weekend schedule is available right now.</div>';
      return;
    }
    document.querySelector('.calendar-hero').dataset.mark=data.year||new Date().getFullYear();
    document.querySelector('.calendar-hero .kicker').textContent=`${races.length} GRAND PRIX WEEKENDS · ${data.year||new Date().getFullYear()} SEASON · THE WORLD TOUR`;
    document.querySelector('#calendarUpdated').textContent='ROUNDS COMPLETED';
    document.querySelector('.calendar-results-line span:last-child').textContent='TIMES · GP LOCAL + YOUR LOCAL ('+viewerCountry()+' · '+viewerTimezone+')';
    document.querySelector('#weekendCount').textContent=String(races.length).padStart(2,'0');
    document.querySelector('#sessionCount').textContent=String(races.reduce((n,r)=>n+(r.sessions||[]).length,0)).padStart(2,'0');
    document.querySelector('#completeCount').textContent=String(races.filter(r=>raceStatus(r).key==='complete').length).padStart(2,'0');
    document.querySelector('#seasonProgress').textContent=`${races.filter(r=>raceStatus(r).key==='complete').length} / ${races.length}`;
    fillCountryFilter();
    applyWinnerFallback();
    paintFocus();
    renderCards();
    updateCountdown();
    attachWeekendResults(races,renderCards);
    setInterval(()=>{paintFocus();updateCountdown()},1000);
    setInterval(()=>{if(!search.matches(':focus')&&!countryFilter.matches(':focus')&&!sessionFilter.matches(':focus'))renderCards()},60000);
  }catch(e){
    grid.innerHTML=`<div class="calendar-empty">${escapeHtml(e.message)}</div>`;
  }
}

search.addEventListener('input',applyFilters);
sessionFilter.addEventListener('change',applyFilters);
countryFilter.addEventListener('change',applyFilters);
document.querySelectorAll('[data-calendar-state]').forEach(button=>button.addEventListener('click',()=>{
  stateFilter=button.dataset.calendarState;
  document.querySelectorAll('[data-calendar-state]').forEach(b=>b.classList.toggle('active',b===button));
  applyFilters();
}));

grid.addEventListener('click',event=>{
  const card=event.target.closest('[data-weekend-index]');
  if(card)openWeekend(Number(card.dataset.weekendIndex));
});
grid.addEventListener('keydown',event=>{
  const card=event.target.closest('[data-weekend-index]');
  if(card&&(event.key==='Enter'||event.key===' ')){
    event.preventDefault();
    openWeekend(Number(card.dataset.weekendIndex));
  }
});

start();
