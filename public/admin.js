const {api,toast}=window.APEX;const login=document.querySelector('#adminLogin'),dash=document.querySelector('#adminDashboard');let subscribers=[],chatMessages=[];
// --- Sign in: password, then the second factor -------------------------------
// One panel per step so a shared desk never sees anyone else's secret. Each
// operator signs in personally, which is what lets the log name who did what.
const $id=(sel)=>document.querySelector(sel);
const auth={mode:'signin',challenge:'',invite:'',session:null};
const PANEL_FOR={
  '#loginForm':'password',
  '#mfaForm':'mfa',
  '#enrolPanel':'enrol',
  '#recoveryPanel':'recovery'
};
function showAuthPanel(active){
  dash.hidden=true;
  login.hidden=false;
  Object.entries(PANEL_FOR).forEach(([sel,step])=>{$id(sel).hidden=step!==active});
}
async function init(){
  try{
    const status=await api('/api/admin/status');
    auth.session=null;
    auth.mode='signin';
    auth.invite='';
    // An invitation link has to work even in a browser that is already signed
    // in: an owner opening someone else's link, or a shared desk machine, would
    // otherwise land on the dashboard and never see the invitation at all.
    const token=new URLSearchParams(location.search).get('invite');
    if(token){auth.signedInAs=status.authenticated&&status.account?status.account.actor:null;await startInvite(token);return}
    if(status.authenticated){await enterDashboard(status.account);return}
    auth.setup=!status.configured&&status.canBootstrap;
    auth.mode=auth.setup?'setup':'signin';
    renderSignInCopy();
    if(!status.configured&&!status.canBootstrap)$id('#loginMessage').textContent='First-run setup is only available from localhost. Run the server on this device, or sign in with an operator account.';
    showAuthPanel('password');
  }catch(e){login.hidden=false;showAuthPanel('password');$id('#loginMessage').textContent=e.message}
}
function renderSignInCopy(){
  const setup=auth.mode==='setup';
  $id('#loginEyebrow').textContent=setup?'FIRST-RUN SETUP':'OPERATOR SIGN IN';
  $id('#loginHeading').innerHTML='AUTHORISE <em style="color:var(--red)">ACCESS.</em>';
  $id('#loginHelp').textContent=setup?'Create the first owner account: a password of at least 12 characters, then an authenticator app. This one-time setup only works from localhost.':'Sign in with your own operator account. Leave the name empty to use the server password (owners only, no second factor).';
  $id('#accountLabel').hidden=setup;$id('#adminAccount').hidden=setup;
  $id('#nameGroup').hidden=!setup;$id('#emailGroup').hidden=!setup;
  $id('#passwordConfirmGroup').hidden=!setup;
  $id('#adminPassword').autocomplete=setup?'new-password':'current-password';
  $id('#loginSubmit').textContent=setup?'CONTINUE TO TWO-FACTOR ↗':'SIGN IN ↗';
}
async function startInvite(token){
  auth.invite=token;
  auth.mode='invite';
  try{
    const invite=await api(`/api/admin/invite?token=${encodeURIComponent(token)}`);
    if(!invite.ok){showAuthPanel('password');renderSignInCopy();$id('#loginMessage').textContent=invite.error;return}
    $id('#loginEyebrow').textContent=`INVITATION · ${invite.roleLabel}`;
    $id('#loginHeading').innerHTML='JOIN THE <em style="color:var(--red)">CONTROL ROOM.</em>';
    const already=auth.signedInAs?` This browser is signed in as ${auth.signedInAs}; accepting switches it to the invited operator.`:'';
    $id('#loginHelp').textContent=`${invite.invitedBy||'An owner'} invited you as ${invite.roleLabel}. ${invite.roleBlurb||''} Choose a password of at least ${invite.passwordMin} characters — nobody else sees it — then enrol an authenticator app.${already}`;
    $id('#accountLabel').hidden=true;$id('#adminAccount').hidden=true;
    $id('#nameGroup').hidden=false;$id('#adminName').value=invite.name||'';
    $id('#emailGroup').hidden=true;
    $id('#passwordConfirmGroup').hidden=false;
    $id('#adminPassword').autocomplete='new-password';
    $id('#loginSubmit').textContent='SET PASSWORD AND CONTINUE ↗';
    showAuthPanel('password');
  }catch(e){showAuthPanel('password');renderSignInCopy();$id('#loginMessage').textContent=e.message}
}
function startEnrolment(result){
  if(result.challenge)auth.challenge=result.challenge;
  $id('#enrolKicker').textContent=auth.invite?'FINISH YOUR INVITATION':'TURN ON TWO-FACTOR';
  $id('#enrolIntro').innerHTML='Add this key to your authenticator app (Google Authenticator, 1Password, Authy), then enter the code it shows. Until a code is confirmed the account cannot be used at all.<br><b>Manual key:</b> type or paste it into the app; there is no QR code yet.';
  $id('#enrolSecret').textContent=result.secret||'';
  $id('#enrolUri').setAttribute('href',result.uri||'#');
  $id('#enrolCode').value='';
  $id('#enrolMessage').textContent='';
  showAuthPanel('enrol');
  $id('#enrolCode').focus();
}
function showRecovery(codes){
  $id('#recoveryList').innerHTML=(codes||[]).map(c=>`<li>${window.APEX.escapeHtml(c)}</li>`).join('')||'<li>—</li>';
  showAuthPanel('recovery');
}
function copyText(text,note){
  try{ navigator.clipboard.writeText(text).then(()=>toast(note||'Copied.'),()=>toast('Select the text and copy it manually.')) }
  catch{ toast('Select the text and copy it manually.') }
}
function operatorFrom(account){return account?{actor:account.actor,roleLabel:account.roleLabel,breakGlass:account.breakGlass,permissions:account.permissions||[]}:null}
async function enterDashboard(account){
  auth.session=operatorFrom(account);
  login.hidden=true;
  dash.hidden=false;
  renderSession(account);
  applyRoleVisibility((account&&account.permissions)||[]);
  await loadAdmin();
  loadAdminExtras();
}
function renderSession(account){
  const pill=$id('#sessionPill');
  if(!account){pill.textContent='—';return}
  pill.textContent=account.breakGlass?`${String(account.actor).toUpperCase()} · NO SECOND FACTOR`:`${String(account.actor).toUpperCase()} · ${account.roleLabel}`;
  pill.classList.toggle('is-break-glass',Boolean(account.breakGlass));
  $id('#myRole').textContent=account.breakGlass?'SERVER PASSWORD':account.roleLabel;
}
// Cards the signed-in role has no business seeing. The server refuses those
// routes anyway; this only keeps the panel honest about what it can do.
const CARD_PERMISSIONS={
  'PUBLIC LIVE PAGE':'config','SITE ANNOUNCEMENT':'config','LIVE CHAT':'chat','TEAM RADIO':'radio',
  'NEWS TUNNEL':'news','SERVER STATUS':'diagnostics','SYSTEM':'diagnostics','LIVE FEED':'diagnostics','OPERATOR LOG':'audit',
  'OPT-IN SUBSCRIBERS':'export','OPERATORS':'operators','MY ACCOUNT':null
};
function applyRoleVisibility(permissions){
  document.querySelectorAll('#adminDashboard .admin-card').forEach(card=>{
    const kicker=(card.querySelector('.kicker')?.textContent||'').trim();
    const needed=CARD_PERMISSIONS[kicker];
    card.hidden=Boolean(needed)&&!permissions.includes(needed);
  });
}
document.querySelector('#loginForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const msg=$id('#loginMessage');msg.textContent='';
  const password=$id('#adminPassword').value;
  const confirm=$id('#adminPasswordConfirm').value;
  if(auth.mode!=='signin'&&password!==confirm){msg.textContent='Those passwords do not match.';return}
  const body={password};
  try{
    if(auth.mode==='setup'){
      body.name=$id('#adminName').value;
      body.email=$id('#adminEmail').value;
      const result=await api('/api/admin/bootstrap',{method:'POST',body:JSON.stringify(body)});
      $id('#adminPassword').value='';$id('#adminPasswordConfirm').value='';
      startEnrolment(result);
      return;
    }
    if(auth.mode==='invite'){
      body.token=auth.invite;
      body.name=$id('#adminName').value;
      const result=await api('/api/admin/invite/accept',{method:'POST',body:JSON.stringify(body)});
      $id('#adminPassword').value='';$id('#adminPasswordConfirm').value='';
      startEnrolment(result);
      return;
    }
    body.account=$id('#adminAccount').value.trim();
    const result=await api('/api/admin/login',{method:'POST',body:JSON.stringify(body)});
    $id('#adminPassword').value='';
    if(result.breakGlass){await init();return}
    if(result.mfaRequired){
      auth.challenge=result.challenge;
      $id('#mfaIntro').textContent=`Enter the six-digit code from the authenticator for ${result.account.name} (${result.account.roleLabel}).`;
      $id('#mfaCode').value='';
      $id('#mfaMessage').textContent='';
      showAuthPanel('mfa');
      $id('#mfaCode').focus();
      return;
    }
    await init();
  }catch(err){msg.textContent=err.message}
});
document.querySelector('#mfaForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const msg=$id('#mfaMessage');msg.textContent='';
  try{
    await api('/api/admin/login/mfa',{method:'POST',body:JSON.stringify({challenge:auth.challenge,code:$id('#mfaCode').value})});
    $id('#mfaCode').value='';
    await init();
  }catch(err){msg.textContent=err.message}
});
document.querySelector('#mfaBack').addEventListener('click',()=>{
  auth.challenge='';
  history.replaceState(null,'','/admin');
  renderSignInCopy();
  showAuthPanel('password');
});
document.querySelector('#enrolForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const msg=$id('#enrolMessage');msg.textContent='';
  const code=$id('#enrolCode').value;
  try{
    const result=await api(auth.invite?'/api/admin/invite/accept':'/api/admin/bootstrap/mfa',{
      method:'POST',
      body:JSON.stringify(auth.invite?{token:auth.invite,challenge:auth.challenge,code}:{challenge:auth.challenge,code})
    });
    auth.invite='';
    history.replaceState(null,'','/admin');
    showRecovery(result.recoveryCodes);
  }catch(err){msg.textContent=err.message}
});
document.querySelector('#recoveryDone').addEventListener('click',()=>init());
document.querySelector('#copyEnrolSecret').addEventListener('click',()=>copyText($id('#enrolSecret').textContent,'Key copied.'));
init();
// Only the panels this role may read are fetched; asking for the rest would
// just fill the panel with 403s.
function hasPermission(permission){return Boolean(auth.session&&auth.session.permissions.includes(permission))}
async function loadAdmin(){
  try{
    if(hasPermission('config')){
      const c=await api('/api/admin/config');
      document.querySelector('#sessionLabel').value=c.sessionLabel||'';
      document.querySelector('#streamUrl').value=c.streamUrl||'';
      document.querySelector('#sessionStatus').value=c.status||'scheduled';
      document.querySelector('#adminStatus').innerHTML=`<div class="admin-list-row"><span>PUBLIC STATUS</span><span>${(c.status||'scheduled').toUpperCase()}</span></div><div class="admin-list-row"><span>EMBED SAVED</span><span>${c.streamUrl?'YES':'NO'}</span></div><div class="admin-list-row"><span>LAST UPDATED</span><span>${c.updatedAt?new Date(c.updatedAt).toLocaleString():'NOT YET'}</span></div><div class="admin-list-row"><span>STORAGE</span><span>SERVER · JSON FILE</span></div>`;
      applySettings(c);
      renderPreview(document.querySelector('#streamUrl').value);
    }
    if(hasPermission('export')){const data=await api('/api/admin/newsletter');subscribers=data.subscribers||[];renderSubscribers()}
    if(hasPermission('chat'))loadChat();
  }catch(e){toast(e.message);if(e.message.includes('Sign in'))init()}
}
function renderSubscribers(){const root=document.querySelector('#subscriberList');root.innerHTML=subscribers.length?subscribers.map(s=>`<div class="admin-list-row"><span>${window.APEX.escapeHtml(s.email)}</span><span>${new Date(s.createdAt).toLocaleDateString()}</span></div>`).join(''):'<div class="admin-list-row"><span>NO SUBSCRIBERS YET</span></div>'}
// Live chat moderation. The chat only accepts messages while the broadcast is
// live, so this list is normally empty between race weekends.
async function loadChat(){const root=document.querySelector('#chatModeration');try{const data=await api('/api/admin/chat');chatMessages=data.messages||[];const live=Boolean(data.live);root.innerHTML=chatMessages.length?chatMessages.map(m=>`<div class="admin-list-row"><span><b style="color:#f0eee8">${window.APEX.escapeHtml(m.name)}</b> · ${window.APEX.escapeHtml(m.text)}</span><span><time style="margin-right:10px;color:#8c8a85">${window.APEX.escapeHtml(new Date(m.at).toLocaleTimeString())}</time><button class="button-quiet chat-delete" data-id="${Number(m.id)}">DELETE</button></span></div>`).join(''):`<div class="admin-list-row"><span>NO CHAT MESSAGES YET</span><span>${live?'CHAT IS OPEN':'CHAT LOCKED'}</span></div>`}catch(e){root.innerHTML=`<div class="admin-list-row"><span>${window.APEX.escapeHtml(e.message)}</span></div>`}}
document.querySelector('#chatModeration').addEventListener('click',async e=>{const button=e.target.closest('.chat-delete');if(!button)return;try{await api(`/api/admin/chat/${Number(button.dataset.id)}`,{method:'DELETE'});await loadChat();toast('Message deleted.')}catch(err){toast(err.message)}});
document.querySelector('#refreshChat').addEventListener('click',()=>loadChat());
document.querySelector('#clearChat').addEventListener('click',async()=>{if(!confirm('Delete every live chat message?'))return;try{await api('/api/admin/chat',{method:'DELETE'});await loadChat();toast('Chat cleared.')}catch(err){toast(err.message)}});
document.querySelector('#configForm').addEventListener('submit',async e=>{e.preventDefault();const msg=document.querySelector('#configMessage');msg.textContent='Saving to server…';try{await api('/api/admin/config',{method:'PUT',body:JSON.stringify({sessionLabel:document.querySelector('#sessionLabel').value,streamUrl:document.querySelector('#streamUrl').value,status:document.querySelector('#sessionStatus').value})});msg.textContent='Saved. The public Race Control page will update shortly.';await loadAdmin()}catch(err){msg.textContent=err.message}});
async function logout(){try{await api('/api/admin/logout',{method:'POST',body:'{}'})}finally{await init()}}
document.querySelector('#logoutButton').addEventListener('click',logout);document.querySelector('#logoutButton2').addEventListener('click',logout);
document.querySelector('#exportSubscribers').addEventListener('click',()=>{const csv=['email,subscribed_at',...subscribers.map(s=>{const email=/^[=+\-@]/.test(s.email)?`'${s.email}`:s.email;return `"${email.replace(/"/g,'""')}","${s.createdAt}"`})].join('\r\n');const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));link.download='apex-subscribers.csv';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000)});

// --- Settings that share the config endpoint ---------------------------------
const esc=v=>window.APEX.escapeHtml(String(v??''));
function adminRow(label,value){return `<div class="admin-list-row"><span>${label}</span><span>${value}</span></div>`}
function applySettings(c){
  const bn=c.banner||{};
  document.querySelector('#bannerText').value=bn.text||'';
  document.querySelector('#bannerTone').value=bn.tone==='alert'?'alert':'info';
  document.querySelector('#bannerEnabled').checked=Boolean(bn.enabled);
  document.querySelector('#chatSlow').value=String(Number(c.chatSlowSeconds)||0);
  const rd=c.radio||{};
  document.querySelector('#radioEnabled').value=rd.enabled===false?'off':'on';
  document.querySelector('#radioModel').value=String(rd.model||'whisper-large-v3-turbo');
  bannerPreview();
}
function bannerPreview(){
  const node=document.querySelector('#bannerPreview'),text=document.querySelector('#bannerText').value.trim().slice(0,160),tone=document.querySelector('#bannerTone').value,on=document.querySelector('#bannerEnabled').checked;
  node.className='site-banner is-'+(tone==='alert'?'alert':'info')+' admin-banner-preview';
  node.querySelector('.site-banner-text').textContent=text||'Your announcement appears here.';
  node.hidden=!on;
}
async function saveConfig(patch,messageNode,okText){
  messageNode.textContent='Saving to server…';
  try{
    const data=await api('/api/admin/config',{method:'PUT',body:JSON.stringify(patch)});
    const changed=data.changed||[];
    messageNode.textContent=changed.length?`${okText} (${changed.join(' · ')})`:`${okText} Nothing had changed.`;
    await loadAdmin();loadAudit();
    return data;
  }catch(e){messageNode.textContent=e.message;return null}
}
['#bannerText','#bannerTone','#bannerEnabled'].forEach(sel=>document.querySelector(sel).addEventListener('input',bannerPreview));
document.querySelector('#bannerForm').addEventListener('submit',e=>{e.preventDefault();saveConfig({banner:{enabled:document.querySelector('#bannerEnabled').checked,tone:document.querySelector('#bannerTone').value,text:document.querySelector('#bannerText').value}},document.querySelector('#bannerMessage'),'Announcement saved.')});
document.querySelector('#bannerOff').addEventListener('click',()=>{document.querySelector('#bannerEnabled').checked=false;bannerPreview();saveConfig({banner:{enabled:false,tone:document.querySelector('#bannerTone').value,text:document.querySelector('#bannerText').value}},document.querySelector('#bannerMessage'),'Announcement switched off.')});
document.querySelector('#chatSettingsForm').addEventListener('submit',e=>{e.preventDefault();saveConfig({chatSlowSeconds:Number(document.querySelector('#chatSlow').value)},document.querySelector('#chatSettingsMessage'),'Chat rules saved.')});

// --- Broadcast preview and schedule fill -------------------------------------
let previewTimer=null;
function renderPreview(value){
  const host=document.querySelector('#broadcastPreview'),raw=String(value||'').trim();
  const snippet=raw.match(/<iframe[^>]*\bsrc\s*=\s*["']([^"']+)["']/i);
  const url=snippet?snippet[1]:raw;
  if(!/^https:\/\//i.test(url)){
    if(host.dataset.src){host.dataset.src='';host.innerHTML='<span class="admin-hint">Save an embed to preview it here.</span>'}
    return;
  }
  // Typing a long <iframe …> snippet fires an input event per keystroke, so the
  // frame is only swapped in once the address settles (and never for the same one).
  if(host.dataset.src===url)return;
  host.dataset.src=url;host.innerHTML='';
  const frame=document.createElement('iframe');
  frame.src=url;frame.title='Broadcast preview';
  frame.setAttribute('allow','autoplay; encrypted-media; picture-in-picture; fullscreen');
  host.appendChild(frame);
}
document.querySelector('#streamUrl').addEventListener('input',e=>{clearTimeout(previewTimer);previewTimer=setTimeout(()=>renderPreview(e.target.value),700)});
document.querySelector('#useNextSession').addEventListener('click',async()=>{
  const hint=document.querySelector('#nextSessionHint'),msg=document.querySelector('#configMessage');
  hint.textContent='Checking the schedule…';
  try{
    const rc=await api('/api/race-control');
    const now=Date.now(),next=(rc.sessions||[]).find(s=>Date.parse(s.startsAt)>now);
    if(!next)throw new Error('No upcoming session in the schedule.');
    document.querySelector('#sessionLabel').value=[next.event||next.location||'',next.name||next.type||''].filter(Boolean).join(' · ').toUpperCase().slice(0,80);
    hint.textContent=new Date(next.startsAt).toLocaleString();
    msg.textContent='Label filled from the schedule — press save to publish it.';
  }catch(e){hint.textContent='';msg.textContent=e.message}
});

// --- Diagnostics, tunnel and the operator log --------------------------------
function providerLine(group){
  const names=Object.keys(group||{});
  if(!names.length)return 'NONE CONFIGURED';
  return names.map(n=>`${esc(n)} ${group[n].ok?'OK':'DOWN'}${group[n].latencyMs?` ${group[n].latencyMs}ms`:''}`).join(' · ');
}
async function loadSystem(){
  const root=document.querySelector('#systemStatus');
  try{
    const d=await api('/api/admin/diagnostics'),s=d.storage||{},c=d.counts||{};
    root.innerHTML=adminRow('STORAGE',esc(s.driver||'unknown')+(s.persistent?' · PERSISTENT':' · MEMORY ONLY'))
      +adminRow('RUNTIME',esc(`${d.runtime.node} · ${d.runtime.environment} · up ${Math.round(d.runtime.uptimeSeconds/60)} min`))
      +adminRow('DATA PROVIDERS',providerLine(d.providers&&d.providers.dataProviders))
      +adminRow('AI PROVIDERS',providerLine(d.providers&&d.providers.aiProviders))
      +adminRow('STORE',esc(`${c.chatMessages} chat messages · ${c.subscribers} subscribers · ${c.auditEntries} log entries`))
      +adminRow('CHECKED',esc(new Date().toLocaleTimeString()));
  }catch(e){root.innerHTML=adminRow('DIAGNOSTICS',esc(e.message))}
}
// --- Live feed health ---------------------------------------------------------
// The connection is what decides whether the public page is live, so the panel
// names it plainly: connected, waiting or idle, how old the last frame is, what
// F1's own session status says, and what the site did with that answer.
function sessionText(session){
  if(!session)return '—';
  const label=[session.event,session.name].filter(Boolean).join(' · ')||session.type||'—';
  const when=session.startsAt?new Date(session.startsAt).toLocaleString():'';
  return when?`${label} · ${when}`:label;
}
async function loadLiveFeed(){
  const root=document.querySelector('#liveFeedStatus');
  try{
    const d=await api('/api/admin/live');
    const feed=d.feed||{},v=d.verdict||{},state=d.state||{},timing=d.timing||{};
    const frameAge=Number.isFinite(feed.ageSeconds)?feed.ageSeconds:null;
    const connection=feed.connected
      ?`<b class="live-feed-ok">● CONNECTED</b> · FRAME ${frameAge===null?'—':`${frameAge}s AGO`}`
      :feed.running
        ?'<b class="live-feed-warn">○ CONNECTING</b> · WAITING FOR THE FIRST FRAME'
        :'<b class="live-feed-down">○ IDLE</b> · NOTHING POLLED BETWEEN SESSIONS';
    // F1 repeats itself in these fields (Status and Started are often the same
    // word), so the line names each distinct verdict once.
    const seen=new Set();
    const verdict=[[v.started,'STARTED'],[v.status,'STATUS'],[v.archiveStatus,'ARCHIVE']]
      .filter(([value])=>value&&!seen.has(String(value).toLowerCase())&&seen.add(String(value).toLowerCase()))
      .map(([value,label])=>`${label} ${esc(String(value).toUpperCase())}`);
    const stateLine=state
      ?`${state.live?'<b class="live-feed-ok">ON AIR</b>':'<b class="live-feed-warn">OFF AIR</b>'} · PROOF ${esc(String(state.proof||'—').toUpperCase())}${state.live&&state.kind?` · ${esc(String(state.kind).toUpperCase().replace(/-/g,' '))}`:''}`
      :esc(d.stateError||'unavailable');
    const towerLine=timing
      ?`${esc(String(timing.source||'—').toUpperCase())} · ${Number(timing.cars)||0} CARS · ${timing.live?'<b class="live-feed-ok">LIVE READING</b>':timing.simulated?'<b class="live-feed-warn">SAVED CLASSIFICATION</b>':'ARCHIVE READING'}${timing.refreshedAt?` · READ ${Math.max(0,Math.round((Date.now()-Date.parse(timing.refreshedAt))/1000))}s AGO`:''}`
      :esc(d.timingError||'unavailable');
    root.innerHTML=[
      adminRow('CONNECTION',connection),
      adminRow('SERVICE',esc(`${String(feed.endpoint||'').replace(/^https?:\/\//,'')}${feed.persist?' · ONE KEPT SOCKET':' · PER-REQUEST SOCKET'}`)),
      adminRow('WATCHING',esc(v.sessionKey?`${sessionText({event:v.meetingName,name:v.sessionName})} · KEY ${v.sessionKey}`:'NOTHING YET')),
      adminRow('FEED VERDICT',verdict.length?verdict.join(' · '):'NOTHING PUBLISHED YET'),
      adminRow('FRAMES',esc(`${feed.frames||0} received · ${feed.reconnects||0} reconnect(s)`)),
      adminRow('IN HAND',esc(`${feed.drivers||0} drivers · ${feed.radio||0} radio capture(s)`)),
      adminRow('TOPICS',feed.topics&&feed.topics.length?esc(feed.topics.join(', ')):'NONE YET'),
      feed.error?adminRow('FEED ERROR',`<b class="live-feed-down">${esc(feed.error)}</b>`):'',
      adminRow('SESSION STATE',stateLine),
      adminRow(state&&state.live?'LIVE SESSION':'NEXT SESSION',esc(sessionText(state&&(state.live?(state.liveSession||state.session):state.nextSession)))),
      adminRow('STATE RE-READ',state&&state.nextChangeAt?esc(`${state.pollMs?`${Math.round(state.pollMs/1000)}s hold · `:''}next ${new Date(state.nextChangeAt).toLocaleTimeString()}`):'—'),
      adminRow('TIMING TOWER',towerLine),
      (state&&state.scheduleErrors&&state.scheduleErrors.length)?adminRow('SCHEDULE',`<b class="live-feed-warn">${esc(state.scheduleErrors.join(' · '))}</b>`):'',
      adminRow('CHECKED',esc(new Date().toLocaleTimeString()))
    ].filter(Boolean).join('');
  }catch(e){
    root.innerHTML=adminRow('LIVE FEED',`<b class="live-feed-down">${esc(e.message)}</b>`)+adminRow('EXPECTED','A signed-in operator with diagnostics access sees this panel.');
  }
}
let liveFeedTimer=0;
function startLiveFeedTimer(){
  clearInterval(liveFeedTimer);
  liveFeedTimer=setInterval(()=>{if(document.hidden||!hasPermission('diagnostics'))return;loadLiveFeed()},15000);
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&hasPermission('diagnostics')&&!dash.hidden)loadLiveFeed()});
document.querySelector('#refreshLiveFeed').addEventListener('click',()=>loadLiveFeed());
function renderTunnel(d){
  const root=document.querySelector('#tunnelStatus');
  root.innerHTML=adminRow('STORIES ON THE WIRE',esc(d.total))
    +adminRow('LAST MERGED',esc(d.updatedAt?new Date(d.updatedAt).toLocaleString():'—'))
    +(d.sources||[]).map(s=>`<div class="admin-list-row"><span>${esc(s.name)}${s.error?' · '+esc(s.error):''}</span><span>${s.ok?esc(s.count+' STORIES'):'UNREACHABLE'}</span></div>`).join('');
}
async function loadTunnel(){const root=document.querySelector('#tunnelStatus');try{renderTunnel(await api('/api/news'))}catch(e){root.innerHTML=adminRow('NEWS TUNNEL',esc(e.message))}}
document.querySelector('#pollNews').addEventListener('click',async()=>{
  const root=document.querySelector('#tunnelStatus');
  root.innerHTML=adminRow('POLLING','asking every publisher now…');
  try{const d=await api('/api/admin/news/refresh',{method:'POST',body:'{}'});renderTunnel(d);toast(d.gained?'New stories landed on the wire.':'Feeds polled — nothing new yet.');loadAudit();loadSystem()}
  catch(e){root.innerHTML=adminRow('NEWS TUNNEL',esc(e.message))}
});
async function loadAudit(){
  const root=document.querySelector('#auditLog');
  try{
    const entries=(await api('/api/admin/audit')).entries||[];
    // Lines written before accounts existed have no actor; they came from the
    // one shared password, so they are labelled rather than attributed.
    root.innerHTML=entries.length?entries.map(e=>`<div class="admin-list-row"><span><b style="color:#f0eee8">${esc(e.action)}</b> · ${esc(e.detail)}</span><span><b style="color:#c9c7c2;margin-right:12px">${esc(e.actor?e.actor.toUpperCase():'BEFORE ACCOUNTS')}</b>${esc(new Date(e.at).toLocaleString())}</span></div>`).join(''):adminRow('OPERATOR LOG','NO ACTIONS RECORDED YET');
  }catch(e){root.innerHTML=adminRow('OPERATOR LOG',esc(e.message))}
}
function loadAdminExtras(){
  if(hasPermission('news'))loadTunnel();
  if(hasPermission('diagnostics')){loadSystem();loadLiveFeed();startLiveFeedTimer()}
  if(hasPermission('audit'))loadAudit();
  if(hasPermission('radio'))loadRadio();
  if(hasPermission('operators'))loadOperators();
  loadAccount();
}
document.querySelector('#refreshAudit').addEventListener('click',()=>loadAudit());
document.querySelector('#clearAudit').addEventListener('click',async()=>{if(!confirm('Clear the operator log?'))return;try{await api('/api/admin/audit',{method:'DELETE'});await loadAudit();toast('Operator log cleared.')}catch(e){toast(e.message)}});
document.querySelector('#refreshSystem').addEventListener('click',()=>{loadSystem();loadTunnel()});
document.querySelector('#exportStore').addEventListener('click',async()=>{
  try{
    const res=await fetch('/api/admin/export');
    if(!res.ok)throw new Error(`Export failed (${res.status}).`);
    const blob=await res.blob(),link=document.createElement('a');
    link.href=URL.createObjectURL(blob);link.download=`apex-store-${new Date().toISOString().slice(0,10)}.json`;link.click();
    setTimeout(()=>URL.revokeObjectURL(link.href),1000);
    toast('Store exported.');loadAudit();
  }catch(e){toast(e.message)}
});
// --- Team radio: transcription settings and the calls on file ---------------
async function loadRadio(){
  const root=document.querySelector('#radioStatus');
  try{
    const d=await api('/api/live/radio');
    const items=Array.isArray(d.items)?d.items:[];
    const head=adminRow('TRANSCRIPTION',d.enabled===false?'OFF':'ON · '+esc(String(d.model||'')))
      +adminRow('SESSION',esc((d.session&&d.session.name)||'no session yet'))
      +adminRow('CALLS ON FILE',`${Number(d.transcribed)||0} of ${Number(d.available)||0} transcribed`);
    if(!items.length){
      root.innerHTML=head+'<div class="admin-list-row"><span>NO RECORDINGS YET</span><span>OpenF1 publishes team radio for only some sessions, so an empty list is normal.</span></div>'+ (d.error?`<div class="admin-list-row"><span>FEED</span><span>${esc(d.error)}</span></div>`:'');
      return;
    }
    root.innerHTML=head+items.map(item=>adminRow(
      `${esc(item.code)} · ${item.at?new Date(item.at).toLocaleTimeString():''}`,
      item.transcript?esc(item.transcript.slice(0,180)):(item.status==='pending'?'QUEUED FOR TRANSCRIPTION':item.status==='silent'?'NO SPEECH IN THIS CALL':'NOT TRANSCRIBED')
    )).join('');
  }catch(e){
    document.querySelector('#radioStatus').innerHTML=adminRow('FEED',esc(e.message));
  }
}
document.querySelector('#radioForm').addEventListener('submit',e=>{
  e.preventDefault();
  saveConfig({radio:{enabled:document.querySelector('#radioEnabled').value==='on',model:document.querySelector('#radioModel').value}},document.querySelector('#radioMessage'),'Radio settings saved.');
});
document.querySelector('#refreshRadio').addEventListener('click',()=>loadRadio());
document.querySelector('#radioTranscribeNow').addEventListener('click',async()=>{
  const node=document.querySelector('#radioMessage');
  node.textContent='Transcribing the newest call…';
  try{
    const result=await api('/api/admin/radio/transcribe',{method:'POST',body:JSON.stringify({limit:1})});
    node.textContent=result.done?`Transcribed ${result.done} call${result.done===1?'':'s'} of ${result.total}.`:(result.message||'Nothing to transcribe.');
    await loadRadio();loadAudit();
  }catch(e){node.textContent=e.message}
});
// --- Operator accounts ------------------------------------------------------
// The owner issues one-time invitations here; nobody is ever told a password.
function inviteUrlFor(path){return new URL(path,location.origin).href}

async function loadOperators(){
  const list=document.querySelector('#operatorList');
  const invites=document.querySelector('#inviteList');
  const legend=document.querySelector('#roleLegend');
  try{
    const data=await api('/api/admin/operators');
    document.querySelector('#inviteTtl').textContent=String(data.inviteTtlMinutes||30);
    const role=document.querySelector('#operatorRole');
    if(!role.options.length){
      role.innerHTML=(data.roles||[]).map(r=>`<option value="${r.name}">${r.label}</option>`).join('');
      role.value='operator';
    }
    legend.innerHTML=`<div class="admin-list-row"><span>ROLES</span><span>${(data.roles||[]).map(r=>`${r.label}: ${esc(r.permissions.join(', '))}`).join(' · ')}</span></div>`;
    const mine=data.you;
    list.innerHTML=(data.accounts||[]).map(account=>{
      const state=[];
      if(account.disabled)state.push('SWITCHED OFF');
      if(account.mfa.awaiting)state.push('AWAITING TWO-FACTOR');
      if(!account.mfa.enrolled&&!account.mfa.awaiting)state.push('NO AUTHENTICATOR');
      const isMe=account.id===mine;
      const actions=[
        `<button class="button-quiet" data-op="role" data-id="${account.id}" data-role="${account.role==='owner'?'operator':account.role==='operator'?'moderator':'owner'}">SET ${account.role==='owner'?'OPERATOR':account.role==='operator'?'MODERATOR':'OWNER'}</button>`,
        account.disabled
          ? `<button class="button-quiet" data-op="enable" data-id="${account.id}">TURN BACK ON</button>`
          : `<button class="button-quiet" data-op="disable" data-id="${account.id}">TURN OFF</button>`,
        `<button class="button-quiet" data-op="invite" data-id="${account.id}">NEW INVITE</button>`,
        `<button class="button-quiet" data-op="reset" data-id="${account.id}">RESET 2FA</button>`,
        isMe?'':`<button class="button-quiet" data-op="remove" data-id="${account.id}">REMOVE</button>`
      ].join(' ');
      return `<div class="admin-list-row admin-list-stack"><span><b style="color:#f0eee8">${esc(account.name)}</b> <span class="admin-role-badge">${esc(account.roleLabel)}</span>${account.email?` · ${esc(account.email)}`:''}${isMe?' · <b>YOU</b>':''}<br><small>${state.length?state.join(' · '):'ACTIVE'} · 2FA SINCE ${account.mfa.confirmedAt?esc(new Date(account.mfa.confirmedAt).toLocaleDateString()):'—'} · ${account.mfa.recoveryLeft} RECOVERY CODE(S) LEFT · LAST SIGN-IN ${account.lastLoginAt?esc(new Date(account.lastLoginAt).toLocaleString()):'NEVER'} · ADDED BY ${esc(account.createdBy||'—')}</small></span><span class="admin-row-actions">${actions}</span></div>`;
    }).join('')||adminRow('OPERATORS','NO ACCOUNTS YET — CREATE AN INVITATION');
    invites.innerHTML=(data.invites||[]).length
      ? (data.invites||[]).map(invite=>`<div class="admin-list-row"><span>PENDING INVITE · <b style="color:#f0eee8">${esc(invite.name)}</b> · ${esc(invite.roleLabel)}${invite.email?` · ${esc(invite.email)}`:''}</span><span>EXPIRES ${esc(new Date(invite.expiresAt).toLocaleTimeString())} <button class="button-quiet" data-op="revoke" data-id="${invite.id}">REVOKE</button></span></div>`).join('')
      : adminRow('PENDING INVITES','NONE');
  }catch(e){
    document.querySelector('#operatorList').innerHTML=adminRow('OPERATORS',esc(e.message));
  }
}

document.querySelector('#inviteForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const msg=document.querySelector('#inviteMessage');
  msg.textContent='Creating the link…';
  try{
    const result=await api('/api/admin/operators',{method:'POST',body:JSON.stringify({
      name:document.querySelector('#operatorName').value,
      email:document.querySelector('#operatorEmail').value,
      role:document.querySelector('#operatorRole').value
    })});
    document.querySelector('#inviteLink').textContent=inviteUrlFor(result.invitePath);
    document.querySelector('#inviteExpires').textContent=new Date(result.expiresAt).toLocaleTimeString();
    document.querySelector('#inviteResult').hidden=false;
    document.querySelector('#operatorName').value='';
    document.querySelector('#operatorEmail').value='';
    msg.textContent=`Invitation ready for ${result.name}.`;
    await loadOperators();loadAudit();
  }catch(err){msg.textContent=err.message}
});

document.querySelector('#refreshOperators').addEventListener('click',()=>loadOperators());
document.querySelector('#copyInvite').addEventListener('click',()=>copyText(document.querySelector('#inviteLink').textContent,'Invitation link copied.'));

document.querySelector('#operatorList').addEventListener('click',async e=>{
  const button=e.target.closest('[data-op]');
  if(!button)return;
  const id=button.dataset.id,op=button.dataset.op;
  try{
    if(op==='role'){
      await api(`/api/admin/operators/${id}`,{method:'PATCH',body:JSON.stringify({role:button.dataset.role})});
      toast('Role updated. Their old sessions are already invalid.');
    }else if(op==='enable'||op==='disable'){
      await api(`/api/admin/operators/${id}`,{method:'PATCH',body:JSON.stringify({disabled:op==='disable'})});
      toast(op==='disable'?'Account switched off.':'Account switched back on.');
    }else if(op==='invite'){
      const result=await api(`/api/admin/operators/${id}/invite`,{method:'POST'});
      document.querySelector('#inviteLink').textContent=inviteUrlFor(result.invitePath);
      document.querySelector('#inviteExpires').textContent=new Date(result.expiresAt).toLocaleTimeString();
      document.querySelector('#inviteResult').hidden=false;
      toast('New invitation link ready.');
    }else if(op==='reset'){
      if(!confirm('Withdraw this account\u2019s authenticator? They cannot sign in until they enrol a new one from the link you are about to get.'))return;
      const result=await api(`/api/admin/operators/${id}/reset-mfa`,{method:'POST'});
      document.querySelector('#inviteLink').textContent=inviteUrlFor(result.invitePath);
      document.querySelector('#inviteExpires').textContent=new Date(result.expiresAt).toLocaleTimeString();
      document.querySelector('#inviteResult').hidden=false;
      toast('Authenticator reset. Send them the new link.');
    }else if(op==='remove'){
      if(!confirm('Remove this operator account? Their sessions stop working immediately.'))return;
      await api(`/api/admin/operators/${id}`,{method:'DELETE'});
      toast('Account removed.');
    }
    await loadOperators();loadAudit();
  }catch(err){toast(err.message)}
});

document.querySelector('#inviteList').addEventListener('click',async e=>{
  const button=e.target.closest('[data-op="revoke"]');
  if(!button)return;
  try{await api(`/api/admin/invites/${button.dataset.id}`,{method:'DELETE'});toast('Invitation revoked.');await loadOperators();loadAudit()}
  catch(err){toast(err.message)}
});

// --- My account -------------------------------------------------------------
function renderCodes(host,codes){
  host.innerHTML=(codes||[]).map(c=>`<li>${esc(c)}</li>`).join('');
  host.hidden=false;
}
async function loadAccount(){
  const root=document.querySelector('#myAccount');
  try{
    const me=await api('/api/admin/me');
    document.querySelector('#myRole').textContent=me.breakGlass?'SERVER PASSWORD':me.roleLabel;
    const rows=[
      adminRow('SIGNED IN AS',esc(me.actor)),
      adminRow('ROLE',esc(me.roleLabel)),
      adminRow('THIS ROLE CAN',esc((me.permissions||[]).join(', ')||'nothing yet')),
      adminRow('SECOND FACTOR',me.breakGlass?'NOT AVAILABLE WITH THE SERVER PASSWORD':(me.account&&me.account.mfa.enrolled?'AUTHENTICATOR ENROLLED':'NOT ENROLLED')),
      adminRow('RECOVERY CODES',me.breakGlass?'—':String(me.account&&me.account.mfa.recoveryLeft)),
      me.breakGlass?adminRow('NOTE','The server password is a break-glass credential: one hour, no second factor, and every action is logged as “server password”. Create an account for yourself in Operators so you can sign in personally.'):''
    ];
    root.innerHTML=rows.join('');
    // The server password cannot change its own password here, or enrol anything.
    document.querySelector('#passwordForm').hidden=Boolean(me.breakGlass);
    document.querySelector('#replaceMfa').hidden=Boolean(me.breakGlass);
    document.querySelector('#reissueRecovery').hidden=Boolean(me.breakGlass);
    document.querySelector('#signOutEverywhere').hidden=Boolean(me.breakGlass);
  }catch(e){root.innerHTML=adminRow('MY ACCOUNT',esc(e.message))}
}
document.querySelector('#passwordForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const msg=document.querySelector('#passwordMessage');
  msg.textContent='Changing…';
  try{
    await api('/api/admin/me/password',{method:'POST',body:JSON.stringify({
      current:document.querySelector('#currentPassword').value,
      next:document.querySelector('#nextPassword').value
    })});
    document.querySelector('#currentPassword').value='';
    document.querySelector('#nextPassword').value='';
    msg.textContent='Password changed. Other sessions have been signed out.';
    await loadAccount();loadAudit();
  }catch(err){msg.textContent=err.message}
});
document.querySelector('#replaceMfa').addEventListener('click',()=>{
  const form=document.querySelector('#accountMfaForm');
  form.hidden=!form.hidden;
});
document.querySelector('#accountMfaForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const msg=document.querySelector('#accountMessage');
  msg.textContent='Requesting a new key…';
  try{
    const result=await api('/api/admin/me/mfa/start',{method:'POST',body:JSON.stringify({password:document.querySelector('#accountMfaPassword').value})});
    document.querySelector('#accountMfaSecret').textContent=result.secret;
    document.querySelector('#accountMfaUri').setAttribute('href',result.uri);
    document.querySelector('#accountMfaPanel').hidden=false;
    msg.textContent='Add the key to your app, then confirm a code below. Your current authenticator keeps working until you do.';
  }catch(err){msg.textContent=err.message}
});
document.querySelector('#accountMfaConfirm').addEventListener('submit',async e=>{
  e.preventDefault();
  const msg=document.querySelector('#accountMessage');
  try{
    const result=await api('/api/admin/me/mfa/confirm',{method:'POST',body:JSON.stringify({code:document.querySelector('#accountMfaCode').value})});
    document.querySelector('#accountMfaCode').value='';
    document.querySelector('#accountMfaPanel').hidden=true;
    renderCodes(document.querySelector('#accountCodeList'),result.recoveryCodes);
    document.querySelector('#accountCodes').hidden=false;
    msg.textContent='Authenticator replaced. Save the new recovery codes above.';
    await loadAccount();loadAudit();
  }catch(err){msg.textContent=err.message}
});
document.querySelector('#copyAccountSecret').addEventListener('click',()=>copyText(document.querySelector('#accountMfaSecret').textContent,'Key copied.'));
document.querySelector('#reissueRecovery').addEventListener('click',async()=>{
  const password=prompt('Confirm your password to reissue recovery codes:');
  if(password===null)return;
  try{
    const result=await api('/api/admin/me/mfa/recovery',{method:'POST',body:JSON.stringify({password})});
    renderCodes(document.querySelector('#accountCodeList'),result.recoveryCodes);
    document.querySelector('#accountCodes').hidden=false;
    toast('New recovery codes issued. The old ones are dead.');
    await loadAccount();loadAudit();
  }catch(e){toast(e.message)}
});
document.querySelector('#signOutEverywhere').addEventListener('click',async()=>{
  try{
    await api('/api/admin/me/signout-everywhere',{method:'POST'});
    toast('Other sessions signed out.');
    await loadAccount();loadAudit();
  }catch(e){toast(e.message)}
});
