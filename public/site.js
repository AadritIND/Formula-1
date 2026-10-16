(()=>{
const pageName=document.body.dataset.page||'';
const navItems=[['Home','/','home'],['Live','/live','live'],['Timing','/timing','timing'],['Standings','/standings','standings'],['Calendar','/calendar','calendar'],['News Garage','/news-garage','news'],['Fan zone','/fan-zone','fan-zone']];
const headerRoot=document.querySelector('#siteHeader');
if(headerRoot)headerRoot.innerHTML=`<div class="topline"><span><i class="pulse"></i> THE PADDOCK NEVER SLEEPS</span><span class="top-center">A FAN-POWERED MOTORSPORT JOURNAL</span><span>EST. 2026 <b>✳</b> BUILT FOR THE GRID</span></div><header class="nav"><a class="brand" href="/" aria-label="Apex home"><span class="brandmark"><svg viewBox="0 0 42 30"><path d="M2 24 15 4h8l-7 11h9l8-11h7L26 26h-8l5-8h-9l-5 8H2Z" fill="currentColor"/><path d="M3 28h25" stroke="currentColor" stroke-width="2"/></svg></span><span>APEX<span class="brand-dot">.</span><small>RACE CULTURE</small></span></a><button class="menu-toggle" aria-label="Open navigation">☰</button><nav class="navlinks">${navItems.map(([label,url,key])=>`<a class="${pageName===key?'active':''}" href="${url}">${label.toUpperCase()}</a>`).join('')}</nav><a class="nav-cta" href="/admin"><span class="live-dot"></span> RACE CONTROL <span>↗</span></a></header>`;
const footerRoot=document.querySelector('#siteFooter');
if(footerRoot)footerRoot.innerHTML=`<footer class="footer"><a class="brand" href="/"><span class="brandmark"><svg viewBox="0 0 42 30"><path d="M2 24 15 4h8l-7 11h9l8-11h7L26 26h-8l5-8h-9l-5 8H2Z" fill="currentColor"/><path d="M3 28h25" stroke="currentColor" stroke-width="2"/></svg></span><span>APEX<span class="brand-dot">.</span><small>RACE CULTURE</small></span></a><div class="footer-center">THE RACE IS NEVER JUST SUNDAY<span>AN INDEPENDENT FAN PROJECT · NOT AFFILIATED WITH FORMULA 1</span></div><div class="footer-links"><a href="/privacy">PRIVACY</a><a href="/terms">TERMS</a><a href="/admin">ADMIN</a></div><a class="back-top" href="#top">↑</a><div class="copyright">© 2026 APEX RACE CULTURE. BUILT FOR THE LOVE OF THE SPORT.</div></footer>`;
document.querySelector('.menu-toggle')?.addEventListener('click',()=>document.querySelector('.navlinks')?.classList.toggle('open'));
document.querySelectorAll('.navlinks a').forEach(a=>a.addEventListener('click',()=>document.querySelector('.navlinks')?.classList.remove('open')));

// Operator announcement strip: one small config read per page load, rendered
// above the site chrome and dismissible for the rest of the session.
async function renderBanner(){
  try{
    const cfg=await api('/api/public/config');
    const banner=cfg.banner||{},text=String(banner.text||'').trim();
    if(!banner.enabled||!text)return;
    try{if(sessionStorage.getItem('apex_banner')===text)return}catch{}
    const node=document.createElement('div');
    node.className='site-banner is-'+(banner.tone==='alert'?'alert':'info');
    node.innerHTML='<span class="site-banner-tag">RACE CONTROL</span><span class="site-banner-text">'+escapeHtml(text)+'</span><button type="button" class="site-banner-close" aria-label="Dismiss announcement">✕</button>';
    node.querySelector('.site-banner-close').addEventListener('click',()=>{try{sessionStorage.setItem('apex_banner',text)}catch{}node.remove()});
    document.body.insertBefore(node,document.body.firstChild);
  }catch{/* an announcement is never worth blocking the page for */}
}
renderBanner();

async function api(path,options={}){
  const response=await fetch(path,{...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});
  const data=await response.json().catch(()=>({error:'Unexpected server response.'}));
  if(!response.ok)throw new Error(data.error||`Request failed (${response.status}).`);
  return data;
}

async function openF1Schedule(){
  const year=new Date().getUTCFullYear(),response=await fetch(`https://api.openf1.org/v1/sessions?year=${year}`);
  if(!response.ok)throw new Error(`OpenF1 schedule unavailable (${response.status}).`);
  const sessions=(await response.json()).filter(s=>!s.is_cancelled&&!/^Day\s+\d+$/i.test(s.session_name||'')&&s.session_type!=='Testing').map(s=>{
    const offset=s.gmt_offset||'00:00:00',[h='0',m='0']=offset.split(':'),mins=Number(h)*60+Math.sign(Number(h)||1)*Number(m),local=iso=>iso?new Date(Date.parse(iso)+mins*60000).toISOString():null;
    return{id:s.session_key,meetingId:s.meeting_key,name:s.session_name,type:s.session_type,event:s.meeting_name||`${s.location||''} Grand Prix`,country:s.country_name,location:s.location,circuit:s.circuit_short_name,circuitKey:s.circuit_key,startsAt:s.date_start,endsAt:s.date_end,offset,localStart:local(s.date_start),localEnd:local(s.date_end),cancelled:false};
  }).sort((a,b)=>Date.parse(a.startsAt)-Date.parse(b.startsAt));
  const now=Date.now(),activeSession=sessions.find(s=>Date.parse(s.startsAt)<=now&&Date.parse(s.endsAt)>=now)||null,nextSession=sessions.find(s=>Date.parse(s.startsAt)>now)||null,latestSession=sessions.filter(s=>Date.parse(s.endsAt)<now).at(-1)||null;
  return{source:'OpenF1',updatedAt:new Date().toISOString(),year,activeSession,nextSession,latestSession,sessions};
}

async function openF1Json(path){const r=await fetch(`https://api.openf1.org/v1/${path}`);if(!r.ok)throw new Error(`OpenF1 returned ${r.status}`);return r.json()}

// Direct-provider fallbacks. The APEX API already chains OpenF1 -> Jolpica on
// the server; these run in the browser as an independent second network path
// when the server can only return a saved snapshot.

async function jolpicaJson(path){const r=await fetch(`https://api.jolpi.ca/ergast/f1/${path}`,{headers:{Accept:'application/json'}});if(!r.ok)throw new Error(`Jolpica returned ${r.status}`);return r.json()}

async function openF1Standings(){
  try{
    const year=new Date().getUTCFullYear();
    const [d,c]=await Promise.all([jolpicaJson(`${year}/driverstandings.json`),jolpicaJson(`${year}/constructorstandings.json`).catch(()=>null)]);
    const list=d?.MRData?.StandingsTable?.StandingsLists?.[0]||{};
    const drivers=(list.DriverStandings||[]).map(row=>{
      const code=row.Driver?.code||'',name=`${row.Driver?.givenName||''} ${row.Driver?.familyName||''}`.trim();
      return{position:Number(row.position),name,code,team:row.Constructors?.[0]?.name||'—',headshotUrl:driverFallbacks[code]||'',points:Number(row.points),wins:Number(row.wins)||0};
    });
    const teams=(c?.MRData?.StandingsTable?.StandingsLists?.[0]?.ConstructorStandings||[]).map(row=>({position:Number(row.position),name:row.Constructor?.name||'—',points:Number(row.points)}));
    return drivers.length?{source:`Jolpica · round ${list.round||''}`,updatedAt:new Date().toISOString().slice(0,10),drivers,teams}:null;
  }catch{return null}
}

async function openF1Timing(){
  try{
    const year=new Date().getUTCFullYear();
    const races=(await jolpicaJson(`${year}/races.json?limit=100`))?.MRData?.RaceTable?.Races||[];
    const past=races.filter(r=>Date.parse(`${r.date}T${(r.time||'23:59:59Z').replace('Z','')}Z`)<Date.now());
    const last=past[past.length-1];if(!last)return null;
    const race=(await jolpicaJson(`${year}/${last.round}/results.json`))?.MRData?.RaceTable?.Races?.[0];
    const rows=(race?.Results||[]).map(x=>{
      const code=x.Driver?.code||'',time=x.Time?.time||'';
      return{position:Number(x.position),code,driver:`${x.Driver?.givenName||''} ${x.Driver?.familyName||''}`.trim(),team:x.Constructor?.name||'—',headshotUrl:driverFallbacks[code]||'',gap:Number(x.position)===1?'WINNER':(time?`+${time.replace('+','')} s`:`${x.status||'—'}`),time:Number(x.position)===1?(time||'—'):`${x.laps||0} laps`};
    }).sort((a,b)=>a.position-b.position);
    return rows.length?{source:'Jolpica · race classification',session:`${race.raceName} · Race classification`,updatedAt:race.date,rows}:null;
  }catch{return null}
}

async function backendHealth(){try{return await api('/api/backends')}catch(e){return{ok:false,error:e.message}}}

const driverFallbacks={
  VER:'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/M/MAXVER01_Max_Verstappen/maxver01.png.transform/1col/image.png',
  HAD:'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/I/ISAHAD01_Isack_Hadjar/isahad01.png.transform/1col/image.png',
  RUS:'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/G/GEORUS01_George_Russell/georus01.png.transform/1col/image.png',
  ANT:'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/K/ANDANT01_Kimi_Antonelli/andant01.png.transform/1col/image.png',
  LEC:'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/C/CHALEC01_Charles_Leclerc/chalec01.png.transform/1col/image.png',
  HAM:'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/L/LEWHAM01_Lewis_Hamilton/lewham01.png.transform/1col/image.png',
  NOR:'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/L/LANNOR01_Lando_Norris/lannor01.png.transform/1col/image.png',
  PIA:'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/O/OSCPIA01_Oscar_Piastri/oscpia01.png.transform/1col/image.png',
  ALO:'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/F/FERALO01_Fernando_Alonso/feralo01.png.transform/1col/image.png',
  STR:'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/L/LANSTR01_Lance_Stroll/lanstr01.png.transform/1col/image.png',
  GAS:'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/P/PIEGAS01_Pierre_Gasly/piegas01.png.transform/1col/image.png',
  COL:'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/F/FRACOL01_Franco_Colapinto/fracol01.png.transform/1col/image.png',
  ALB:'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/A/ALEALB01_Alexander_Albon/alealb01.png.transform/1col/image.png',
  SAI:'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/C/CARSAI01_Carlos_Sainz/carsai01.png.transform/1col/image.png',
  LAW:'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/L/LIALAW01_Liam_Lawson/lialaw01.png.transform/1col/image.png',
  LIN:'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/A/ARVLIN01_Arvid_Lindblad/arvlin01.png.transform/1col/image.png',
  OCO:'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/E/ESTOCO01_Esteban_Ocon/estoco01.png.transform/1col/image.png',
  BEA:'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/O/OLIBEA01_Oliver_Bearman/olibea01.png.transform/1col/image.png',
  HUL:'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/N/NICHUL01_Nico_Hulkenberg/nichul01.png.transform/1col/image.png',
  BOR:'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/G/GABBOR01_Gabriel_Bortoleto/gabbor01.png.transform/1col/image.png',
  BOT:'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/V/VALBOT01_Valtteri_Bottas/valbot01.png.transform/1col/image.png',
  PER:'https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/S/SERPER01_Sergio_Perez/serper01.png.transform/1col/image.png'
};

function teamLogo(team){
  const name=String(team||'').toLowerCase();
  const teams=[
    ['mercedes','mercedes'],
    ['ferrari','ferrari'],
    ['red bull','redbullracing'],
    ['mclaren','mclaren'],
    ['racing bulls','racingbulls'],
    ['rb','racingbulls'],
    ['aston martin','astonmartin'],
    ['williams','williams'],
    ['alpine','alpine'],
    ['haas','haasf1team'],
    ['audi','audi'],
    ['cadillac','cadillac']
  ];
  const match=teams.find(([key])=>name.includes(key));
  if(!match)return'';
  const slug=match[1];
  return`https://media.formula1.com/image/upload/c_fit,w_220,h_100/q_auto,f_auto/v1740000001/common/f1/2026/${slug}/2026${slug}logowhite.webp`;
}

function driverPhoto(driver){
  return String(driver?.headshotUrl||driver?.headshot_url||driverFallbacks[driver?.code]||'');
}

function imageOrMark(src,alt,className,mark=''){
  const safeMark=escapeHtml(mark||'F1'),fallback=driverFallbacks[mark]||'';
  const chosenSrc=src||fallback;
  if(!chosenSrc)return`<span class="image-mark ${escapeHtml(className)} is-fallback"><i aria-hidden="true">${safeMark}</i></span>`;
  return`<span class="image-mark ${escapeHtml(className)}"><img src="${escapeHtml(chosenSrc)}" data-fallback="${escapeHtml(fallback)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async"><i aria-hidden="true">${safeMark}</i></span>`;
}

// Global CSP-safe image error catcher that prevents broken image icons everywhere
window.addEventListener('error',function(e){
  if(e.target&&e.target.tagName==='IMG'){
    const img=e.target;
    if(img.dataset.fallback&&img.src!==img.dataset.fallback){
      img.src=img.dataset.fallback;
      img.dataset.fallback='';
    }else{
      img.style.display='none';
      const markWrap=img.closest('.image-mark')||img.parentElement;
      if(markWrap)markWrap.classList.add('is-fallback');
    }
  }
},true);

function toast(message){const node=document.querySelector('#toast');if(!node)return;node.textContent=message;node.classList.add('show');clearTimeout(window.__toastTimer);window.__toastTimer=setTimeout(()=>node.classList.remove('show'),3000)}
function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,a=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[a]))}

window.APEX={api,toast,escapeHtml,openF1Schedule,openF1Json,openF1Standings,openF1Timing,backendHealth,teamLogo,driverPhoto,imageOrMark,driverFallbacks};
// Expose the provider fallbacks globally too, so page scripts can call them directly.
window.openF1Standings=openF1Standings;
window.openF1Timing=openF1Timing;

const pageScripts={home:'/home.js?v=6',live:'/live.js?v=14',timing:'/timing.js?v=5',standings:'/standings.js?v=6',calendar:'/calendar.js?v=14',news:'/news.js?v=2','fan-zone':'/fan-zone.js?v=3',admin:'/admin.js?v=14',privacy:'/privacy.js?v=5'};
if(pageScripts[pageName]){
  const pageScript=document.createElement('script');
  pageScript.src=pageScripts[pageName];
  pageScript.async=false;
  document.body.appendChild(pageScript);
}
})();

