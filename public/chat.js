/* Race Control live chat.
 *
 * The API is the authority on whether the chat is open: /api/chat reports the
 * broadcast state and the server refuses to store a message unless an operator
 * has the session marked live. This panel just mirrors that — it polls quickly
 * while on air, checks slowly while locked so it notices the moment the stream
 * starts, and disables the composer the rest of the time.
 *
 * Lines can also carry emoji reactions. Counts are server-side and arrive with
 * the same poll; the page only remembers which taps belong to this browser so
 * it can highlight them and so a second tap removes rather than double-counts.
 */
(() => {
  const { api, escapeHtml } = window.APEX;
  const card = document.querySelector('#chatCard');
  if (!card) return;

  const log = document.querySelector('#chatLog');
  const empty = document.querySelector('#chatEmpty');
  const count = document.querySelector('#chatCount');
  const form = document.querySelector('#chatForm');
  const nameField = document.querySelector('#chatName');
  const messageField = document.querySelector('#chatMessage');
  const sendButton = document.querySelector('#chatSend');
  const stateChip = document.querySelector('#chatState');
  const note = document.querySelector('#chatNote');

  const side = card.closest('.live-side');
  const stage = document.querySelector('#liveScreen');
  const NAME_KEY = 'apex_chat_name_v1';
  const UID_KEY = 'apex_chat_uid_v1';
  const MINE_KEY = 'apex_chat_reactions_v1';
  const REACT_SET = ['🔥', '❤️', '😂', '😮', '🏁'];
  const LIVE_POLL = 4000;
  const LOCKED_POLL = 20000;

  let live = false;
  let latest = 0;
  let timer = null;
  let total = 0;
  let pinned = true;
  let pollFailed = false;
  // Slow mode is a server rule; the composer just mirrors it so a viewer is not
  // invited to type a message the server is about to refuse.
  let slowSeconds = 4;
  let cooldownUntil = 0;
  let cooldownTimer = null;
  const seen = new Set();
  let reactions = {}; // { [messageId]: { emoji: count } } — server is the authority

  // A stable per-browser id lets the server tell one viewer's taps from another's
  // without an account; the tap ledger itself never leaves the server.
  function viewerUid() {
    let uid = localStorage.getItem(UID_KEY);
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(uid || '')) {
      uid = window.crypto?.randomUUID
        ? crypto.randomUUID().replace(/-/g, '')
        : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`;
      localStorage.setItem(UID_KEY, uid);
    }
    return uid;
  }
  const uid = viewerUid();
  let mine;
  try { mine = new Set((JSON.parse(localStorage.getItem(MINE_KEY) || '[]') || []).filter((k) => typeof k === 'string')); }
  catch { mine = new Set(); }
  function saveMine() { localStorage.setItem(MINE_KEY, JSON.stringify([...mine].slice(-300))); }

  nameField.value = localStorage.getItem(NAME_KEY) || '';
  nameField.addEventListener('change', () => localStorage.setItem(NAME_KEY, nameField.value.trim().slice(0, 24)));

  // Beside the broadcast the column is capped to the video panel, so a busy chat
  // scrolls inside its own log instead of stretching the page.
  function syncLayout() {
    if (!side || !stage) return;
    if (window.innerWidth > 900) side.style.setProperty('--live-side-h', `${Math.round(stage.getBoundingClientRect().height)}px`);
    else side.style.removeProperty('--live-side-h');
  }

  function stamp(iso) {
    const date = new Date(iso || '');
    return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  }

  function messageNode(message) {
    const line = document.createElement('article');
    line.className = 'chat-line is-new';
    line.dataset.id = message.id;
    const picker = REACT_SET.map((emoji) => `<button type="button" data-emoji="${emoji}" title="React ${emoji}">${emoji}</button>`).join('');
    line.innerHTML = `<div class="chat-line-top"><span class="chat-name">${escapeHtml(message.name)}</span><time datetime="${escapeHtml(message.at || '')}">${escapeHtml(stamp(message.at))}</time></div><p>${escapeHtml(message.text)}</p><div class="chat-reacts" data-react="${Number(message.id)}"><div class="chat-react-chips"></div><button class="chat-react-add" type="button" aria-label="React to this line" title="React to this line">☺ +</button><div class="chat-react-pick" hidden>${picker}</div></div>`;
    return line;
  }

  // Chips show every reaction with a count (or one of ours, so it can be undone).
  function renderReactions(id) {
    const row = log.querySelector(`.chat-reacts[data-react="${id}"]`);
    if (!row) return;
    const counts = reactions[id] || {};
    const chips = [];
    for (const emoji of REACT_SET) {
      const count = Number(counts[emoji]) || 0;
      const active = mine.has(`${id}|${emoji}`);
      if (count > 0 || active) {
        chips.push(`<button type="button" class="chat-react-chip${active ? ' mine' : ''}" data-emoji="${emoji}" aria-pressed="${active}" title="${active ? 'Remove your' : 'Add your'} reaction">${emoji}<b>${Math.max(count, active ? 1 : 0)}</b></button>`);
      }
    }
    row.querySelector('.chat-react-chips').innerHTML = chips.join('');
    row.querySelectorAll('.chat-react-pick button').forEach((button) => button.classList.toggle('mine', mine.has(`${id}|${button.dataset.emoji}`)));
  }

  // The poll ships counts for every visible line at once, so this replaces the
  // whole board and forgets taps whose line the operator has removed.
  function syncReactions(map) {
    reactions = map && typeof map === 'object' ? map : {};
    const liveIds = new Set([...log.querySelectorAll('.chat-line')].map((node) => node.dataset.id));
    let mineChanged = false;
    for (const key of [...mine]) {
      if (!liveIds.has(key.split('|')[0])) { mine.delete(key); mineChanged = true; }
    }
    if (mineChanged) saveMine();
    liveIds.forEach((id) => renderReactions(Number(id)));
  }

  async function toggleReaction(id, emoji) {
    if (!live) { note.textContent = 'Reactions open when race control puts the session on air.'; return; }
    const row = log.querySelector(`.chat-reacts[data-react="${id}"]`);
    if (!row || row.dataset.busy === '1') return;
    row.dataset.busy = '1';
    try {
      const data = await api(`/api/chat/${Number(id)}/reaction`, { method: 'POST', body: JSON.stringify({ emoji, uid }) });
      reactions[id] = data.reactions || {};
      const key = `${Number(id)}|${emoji}`;
      if (data.active) mine.add(key); else mine.delete(key);
      saveMine();
      renderReactions(Number(id));
      row.querySelector('.chat-react-pick').hidden = true;
      note.textContent = '';
    } catch (error) {
      note.textContent = error.message;
    } finally {
      if (row.isConnected) row.dataset.busy = '';
    }
  }

  function addMessages(messages) {
    for (const message of messages || []) {
      if (!message || seen.has(message.id)) continue;
      seen.add(message.id);
      latest = Math.max(latest, Number(message.id) || 0);
      log.appendChild(messageNode(message));
      // Keep the DOM as small as the served history.
      while (log.querySelectorAll('.chat-line').length > 200) log.querySelector('.chat-line')?.remove();
    }
    if (pinned) log.scrollTop = log.scrollHeight;
  }

  // The server sends the whole visible window on every poll, so moderation has to
  // show up here too: a line the operator removed must disappear from a page that
  // is already open, without waiting for the viewer to reload.
  function syncLog(messages, serverTotal) {
    const list = Array.isArray(messages) ? messages : [];
    const ids = new Set(list.map((message) => Number(message.id)));
    const windowStart = list.length ? Number(list[0].id) : Infinity;
    const newest = list.length ? Number(list[list.length - 1].id) : 0;
    for (const node of [...log.querySelectorAll('.chat-line')]) {
      const id = Number(node.dataset.id);
      if (!Number.isFinite(id)) { node.remove(); continue; }
      // Everything newer than the newest surviving line is gone (a tail delete or
      // a clear-all), and anything inside the returned window must still be listed.
      if (id > newest || (id >= windowStart && !ids.has(id))) {
        node.remove();
        seen.delete(id);
      }
    }
    addMessages(list);
    total = Number.isFinite(serverTotal) ? Math.max(serverTotal, log.querySelectorAll('.chat-line').length) : total;
    count.textContent = total ? `${total} MESSAGE${total === 1 ? '' : 'S'}` : 'NO MESSAGES YET';
    render();
  }

  function syncComposer() {
    const ready = live && Date.now() >= cooldownUntil;
    sendButton.disabled = !ready;
    if (live && slowSeconds > 5) messageField.placeholder = `SLOW MODE · ONE MESSAGE EVERY ${slowSeconds}s`;
    else messageField.placeholder = 'MESSAGE THE PADDOCK…';
  }

  function startCooldown() {
    clearInterval(cooldownTimer);
    cooldownTimer = setInterval(() => {
      const left = Math.ceil((cooldownUntil - Date.now()) / 1000);
      if (left <= 0) {
        clearInterval(cooldownTimer);
        note.textContent = '';
      } else if (live) {
        note.textContent = `SLOW MODE · NEXT MESSAGE IN ${left}s`;
      }
      syncComposer();
    }, 500);
  }

  function render() {
    const hasLines = Boolean(log.querySelector('.chat-line'));
    card.dataset.chat = live ? 'open' : 'locked';
    stateChip.querySelector('.chat-state-full').textContent = live ? 'ON AIR · CHAT OPEN' : 'LOCKED · OPENS WHEN LIVE';
    stateChip.querySelector('.chat-state-brief').textContent = live ? 'OPEN' : 'LOCKED';
    nameField.disabled = !live;
    messageField.disabled = !live;
    syncComposer();
    if (!hasLines) {
      empty.hidden = false;
      empty.textContent = live
        ? 'No messages yet — be the first on the radio.'
        : 'The paddock chat opens when race control puts the session on air.';
    } else {
      empty.hidden = true;
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(refresh, live ? LIVE_POLL : LOCKED_POLL);
  }

  async function refresh() {
    if (document.hidden) { schedule(); return; }
    try {
      // Always take the full visible window: that reply is the only way to notice a
      // line the operator deleted while this page was open.
      const data = await api('/api/chat');
      const wasLive = live;
      live = Boolean(data.live);
      slowSeconds = Number(data.slowSeconds) || slowSeconds;
      // Clear our own error note once the service answers again.
      if (wasLive !== live || pollFailed) note.textContent = '';
      pollFailed = false;
      syncLog(data.messages, Number(data.total));
      syncReactions(data.reactions);
    } catch (error) {
      pollFailed = true;
      note.textContent = error.message;
    }
    // Re-measure on every poll: the video panel changes size with the schedule
    // cards above it, and the column must stay capped to whatever it is now.
    syncLayout();
    schedule();
  }

  log.addEventListener('scroll', () => { pinned = log.scrollHeight - log.scrollTop - log.clientHeight < 48; });

  // One delegated listener covers every line: "+" opens that line's picker,
  // chips and picker buttons both toggle, and a tap elsewhere closes the picker.
  log.addEventListener('click', (event) => {
    const add = event.target.closest('.chat-react-add');
    const option = event.target.closest('.chat-react-pick button');
    const chip = event.target.closest('.chat-react-chip');
    const holder = event.target.closest('.chat-line');
    if (!holder) return;
    if (!add && !option && !chip) {
      log.querySelectorAll('.chat-react-pick').forEach((pick) => { pick.hidden = true; });
      return;
    }
    if (add) {
      const pick = holder.querySelector('.chat-react-pick');
      const willOpen = pick.hidden;
      log.querySelectorAll('.chat-react-pick').forEach((other) => { other.hidden = true; });
      pick.hidden = !willOpen;
      return;
    }
    toggleReaction(Number(holder.dataset.id), (option || chip).dataset.emoji);
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!live) { note.textContent = 'Chat is closed until the session goes live.'; return; }
    if (Date.now() < cooldownUntil) { note.textContent = 'Slow mode is on — wait for the countdown.'; return; }
    const text = messageField.value.trim();
    if (text.length < 2) { note.textContent = 'Write a message before sending.'; return; }
    const name = nameField.value.trim().slice(0, 24);
    localStorage.setItem(NAME_KEY, name);
    sendButton.disabled = true;
    note.textContent = 'Sending…';
    try {
      const data = await api('/api/chat', { method: 'POST', body: JSON.stringify({ name, text }) });
      messageField.value = '';
      note.textContent = '';
      if (slowSeconds > 5) { cooldownUntil = Date.now() + slowSeconds * 1000; startCooldown(); }
      if (data.message) { addMessages([data.message]); pinned = true; log.scrollTop = log.scrollHeight; }
    } catch (error) {
      note.textContent = error.message;
    }
    syncComposer();
    refresh();
  });

  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  if (window.ResizeObserver && stage) new ResizeObserver(syncLayout).observe(stage);
  window.addEventListener('resize', syncLayout);

  syncLayout();
  render();
  refresh();
})();
