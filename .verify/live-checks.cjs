// Verification for the live path. NOT part of the site.
//
// Drives the running site through every gating case using the mock timetable and
// mock live hub, and asserts what the site actually serves.
//
// Start a FRESH site process before running this: the connector remembers the
// last session it watched, which is exactly what one of these checks tests.

const BASE = process.env.CHECK_BASE || 'http://127.0.0.1:3100';
const MOCK = 'http://127.0.0.1:4010';
const HUB = 'http://127.0.0.1:4011';

let pass = 0;
let fail = 0;
const failures = [];
function ok(name, condition, detail) {
  if (condition) { pass += 1; console.log(`  ok   ${name}`); }
  else { fail += 1; failures.push(name); console.log(`  FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function json(url) {
  const res = await fetch(url, { cache: 'no-store' });
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) }; } catch { return { status: res.status, body: text }; }
}
const state = () => json(`${BASE}/api/live/state`).then((r) => r.body);
const timing = (q = '') => json(`${BASE}/api/live/timing${q}`).then((r) => r.body);
const radio = () => json(`${BASE}/api/live/radio`).then((r) => r.body);
const chat = () => json(`${BASE}/api/chat`).then((r) => r.body);
const setMode = async (mode) => { await fetch(`${MOCK}/control?mode=${mode}`); await sleep(200); };
const connections = () => json(`${HUB}/connections`).then((r) => r.body.connections);
async function until(fn, ms, label) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < ms) {
    last = await fn();
    if (last) return last;
    await sleep(500);
  }
  console.log(`  (timed out waiting for ${label} after ${ms}ms)`);
  return last;
}

(async () => {
  console.log('\n== 1. nothing on air: countdown, and no live connection at all ==');
  await setMode('idle');
  const idleState = await until(async () => { const s = await state(); return s && s.live === false ? s : null; }, 8000, 'idle state');
  ok('session state says not live', idleState && idleState.live === false, JSON.stringify(idleState && { live: idleState.live }));
  ok('next session is the next broadcast session', idleState && idleState.nextSession && idleState.nextSession.name === 'Practice 1', idleState && idleState.nextSession && idleState.nextSession.name);
  ok('the last completed session is offered for the tower', Boolean(idleState && idleState.session));
  const baselineConnections = await connections();
  await sleep(2500);
  const idleTiming = await timing();
  ok('tower falls back to the archive, not the feed', !(idleTiming.feed && idleTiming.feed.connected), JSON.stringify(idleTiming.feed || null));
  ok('tower is not marked live', idleTiming.live !== true && idleTiming.inSession !== true, `live=${idleTiming.live} inSession=${idleTiming.inSession}`);
  const idleConnections = await connections();
  ok('no connection to the live hub while nothing is on air', idleConnections === baselineConnections, `connections=${idleConnections} (was ${baselineConnections})`);
  const idleChat = await chat();
  ok('the paddock chat is locked while nothing is on air', idleChat && idleChat.live === false, JSON.stringify({ live: idleChat && idleChat.live }));

  console.log('\n== 2. a testing session is on air: still not live (it is not a race, sprint or practice) ==');
  await setMode('testing');
  const testingState = await until(async () => { const s = await state(); return s && s.live === false && s.nextSession ? s : null; }, 10000, 'testing state');
  ok('testing does not go live', testingState && testingState.live === false, JSON.stringify(testingState && { live: testingState.live, kind: testingState.kind }));
  await sleep(2000);
  ok('still no live connection during a testing session', (await connections()) === baselineConnections, `connections=${await connections()} (was ${baselineConnections})`);

  console.log('\n== 3. a race is on air: the real-time feed takes over ==');
  await setMode('live');
  const liveState = await until(async () => { const s = await state(); return s && s.live === true ? s : null; }, 15000, 'live state');
  ok('session state goes live when the race window opens', liveState && liveState.live === true, JSON.stringify(liveState && { live: liveState.live, proof: liveState.proof }));
  ok('it knows which session and what kind', liveState && liveState.kind === 'race' && liveState.liveSession && Number(liveState.liveSession.id) === 900001, JSON.stringify(liveState && liveState.liveSession && { id: liveState.liveSession.id, kind: liveState.kind }));
  const liveTower = await until(async () => { const t = await timing(); return t && t.feed && t.feed.connected && Array.isArray(t.drivers) && t.drivers.length ? t : null; }, 20000, 'live tower');
  ok('tower is served from the live feed', Boolean(liveTower && liveTower.feed.connected), JSON.stringify(liveTower && liveTower.feed));
  ok('tower source names the live feed', Boolean(liveTower && /F1 live timing/.test(String(liveTower.source))), liveTower && liveTower.source);
  ok('the running field is on the tower', Boolean(liveTower && liveTower.drivers.length === 21), liveTower && liveTower.drivers.length);
  ok('a retired car is not shown', Boolean(liveTower && !liveTower.drivers.some((d) => Number(d.number) === 23)), JSON.stringify(liveTower && liveTower.drivers.map((d) => d.number).filter((n) => n === 23)));
  const liveChat = await until(async () => { const c = await chat(); return c && c.live === true ? c : null; }, 15000, 'open chat');
  ok('the paddock chat opens with the session', Boolean(liveChat && liveChat.live === true), JSON.stringify({ live: liveChat && liveChat.live }));
  const feedBacked = await until(async () => { const s = await state(); return s && s.proof === 'feed' ? s : null; }, 15000, 'feed-backed state');
  ok('the feed verdict backs the live state', Boolean(feedBacked && feedBacked.proof === 'feed'), feedBacked && feedBacked.proof);
  await sleep(2500);
  const moved = await timing();
  ok('the tower still serves after the deltas keep coming', Boolean(moved && Array.isArray(moved.drivers) && moved.drivers.length), JSON.stringify(moved && moved.error));
  const drivers = (moved && moved.drivers) || [];
  const leader = drivers.find((d) => d.position === 1);
  const second = drivers.find((d) => d.position === 2);
  ok('a delta moved the leader', Boolean(leader && Number(leader.number) === 4 && leader.gapToLeader === 'LEADER'), JSON.stringify(leader && { number: leader.number, gap: leader.gapToLeader }));
  ok('the old leader now carries a real gap', Boolean(second && Number(second.number) === 3 && second.gapToLeader === '+0.412'), JSON.stringify(second && { number: second.number, gap: second.gapToLeader }));
  ok('a new lap time arrives from the delta', Boolean(leader && leader.lastLap && leader.lastLap.time === 95.9), JSON.stringify(leader && leader.lastLap));
  ok('its three sector times arrived too', Boolean(leader && leader.lastLap && leader.lastLap.s1 === 28.1 && leader.lastLap.s2 === 40.9 && leader.lastLap.s3 === 27.9), JSON.stringify(leader && leader.lastLap && [leader.lastLap.s1, leader.lastLap.s2, leader.lastLap.s3]));
  ok('lap count moved from the LapCount delta', Boolean(moved.lap >= 31), moved.lap);
  // The stint delta arrives a couple of frames after the position change, so
  // the tower is given a moment to catch up with it.
  const withTyre = await until(async () => {
    const t = await timing();
    const first = t && Array.isArray(t.drivers) && t.drivers.find((d) => d.position === 1);
    return first && first.tyre && first.tyre.compound === 'HARD' ? first : null;
  }, 10000, 'merged stint');
  ok('the stint array merged, giving a new compound', Boolean(withTyre && withTyre.tyre.compound === 'HARD'), JSON.stringify(withTyre && withTyre.tyre));
  const probe = await timing('?probe=1');
  ok('the probe carries the feed health', Boolean(probe.feed && probe.feed.connected && Number.isFinite(probe.feed.ageSeconds)), JSON.stringify(probe.feed));
  ok('a live reading is held for about a second', Boolean(probe.cacheMs <= 1500), probe.cacheMs);
  ok('the probe says the session is on air', probe.onAir === true || probe.inSession === true, `onAir=${probe.onAir} inSession=${probe.inSession}`);
  const revisionA = probe.revision;
  // The mock moves the session on roughly every four seconds, so the revision
  // has to be sampled either side of one of those moves.
  await sleep(5000);
  const revisionB = (await timing('?probe=1')).revision;
  ok('the revision moves as the session moves', revisionA !== revisionB, `${revisionA} -> ${revisionB}`);
  const liveRadio = await until(async () => { const r = await radio(); return r && r.live && r.items && r.items.length >= 3 ? r : null; }, 15000, 'live radio');
  ok('team radio is live from the session', Boolean(liveRadio && liveRadio.live === true), JSON.stringify(liveRadio && { live: liveRadio.live, items: liveRadio.items && liveRadio.items.length }));
  ok('a capture that arrived during the session is on the panel', Boolean(liveRadio && liveRadio.items.some((i) => /LEC_16_20261025_140200/.test(i.url))), liveRadio && liveRadio.items.map((i) => i.url).slice(0, 2));
  ok('capture audio addresses are built from the session path', Boolean(liveRadio && liveRadio.items.every((i) => i.url.startsWith('http://127.0.0.1:4011/static/2026/2026-10-25_United_States_Grand_Prix/2026-10-25_Race/TeamRadio/'))), liveRadio && liveRadio.items[0] && liveRadio.items[0].url);
  const unnamed = liveRadio && liveRadio.items.filter((i) => !i.code || !i.name);
  ok('each capture names its driver', Boolean(liveRadio && liveRadio.items.every((i) => i.code && i.name)), JSON.stringify(unnamed));
  ok('the hub connection is up and kept', (await connections()) >= 1, `connections=${await connections()}`);
  const liveFeedRadioAge = await radio();
  ok('the radio panel says it is live', liveFeedRadioAge.live === true, JSON.stringify({ live: liveFeedRadioAge.live, source: liveFeedRadioAge.source }));

  console.log('\n== 4. the feed says the session has finished: live stops even though the timetable window is open ==');
  await setMode('finish');
  const afterFinish = await until(async () => { const s = await state(); return s && s.live === false && s.proof === 'feed' ? s : null; }, 15000, 'finished state');
  ok('the feed verdict outranks the timetable', Boolean(afterFinish && afterFinish.live === false && afterFinish.proof === 'feed'), JSON.stringify(afterFinish && { live: afterFinish.live, proof: afterFinish.proof }));
  const finishedTower = await until(async () => { const t = await timing(); return t && (!t.feed || !t.feed.connected) && t.live !== true && t.drivers && t.drivers.length ? t : null; }, 15000, 'post-race tower');
  ok('the tower stands down from live', Boolean(finishedTower), JSON.stringify(finishedTower && { source: finishedTower.source, feed: finishedTower.feed, live: finishedTower.live }));
  const closedChat = await until(async () => { const c = await chat(); return c && c.live === false ? c : null; }, 15000, 'closed chat');
  ok('the paddock chat locks again at the flag', Boolean(closedChat && closedChat.live === false), JSON.stringify({ live: closedChat && closedChat.live }));
  ok('the flag is followed by the feed\u2019s own final classification', Boolean(finishedTower && /final classification/.test(String(finishedTower.source))), finishedTower && finishedTower.source);
  const freedConnection = await until(async () => { const s = await state(); return s && s.feed && s.feed.connected === false ? s : null; }, 15000, 'feed released');
  ok('the live connection is dropped once the session is over', Boolean(freedConnection), JSON.stringify(freedConnection && freedConnection.feed && { running: freedConnection.feed.running, connected: freedConnection.feed.connected }));

  console.log('\n== 5. qualifying also counts as on air ==');
  await setMode('quali');
  const qualiState = await until(async () => { const s = await state(); return s && s.live === true && s.kind === 'qualifying' ? s : null; }, 20000, 'quali state');
  ok('qualifying goes live', Boolean(qualiState && qualiState.live === true && qualiState.kind === 'qualifying'), JSON.stringify(qualiState && { live: qualiState.live, kind: qualiState.kind, proof: qualiState.proof, session: qualiState.session && qualiState.session.name }));

  console.log('\n== 6. sprint qualifying counts too ==');
  await setMode('sprintquali');
  const sprintState = await until(async () => { const s = await state(); return s && s.kind === 'sprint-qualifying' ? s : null; }, 15000, 'sprint quali state');
  ok('sprint qualifying is recognised as a broadcast session', Boolean(sprintState && sprintState.live === true), JSON.stringify(sprintState && { live: sprintState.live, kind: sprintState.kind }));

  await setMode('idle');
  console.log(`\n${pass} passed, ${fail} failed`);
  if (failures.length) console.log('failed: ' + failures.join(' | '));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('harness error:', e); process.exit(2); });
