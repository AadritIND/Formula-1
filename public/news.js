// News Garage: renders the aggregated stream from GET /api/news and keeps it
// live. The server owns the feed loop, so the page only has to re-poll the
// endpoint: anything the tunnel has merged since the last poll lands here and
// gets flagged as new instead of silently replacing the grid.

(() => {
  const grid = document.querySelector('#newsGrid');
  const state = document.querySelector('#newsState');
  const sourcesEl = document.querySelector('#newsSources');
  const updatedEl = document.querySelector('#newsUpdated');
  const refreshBtn = document.querySelector('#newsRefresh');
  const { api, toast, escapeHtml } = window.APEX || {};

  if (!grid || !api) return;

  const POLL_MS = 30000;
  let knownIds = null;
  let lastSignature = '';
  let busy = false;
  let clockTimer = null;

  function timeAgo(iso) {
    const seconds = (Date.now() - Date.parse(iso)) / 1000;
    if (!Number.isFinite(seconds)) return '';
    if (seconds < 60) return 'JUST NOW';
    if (seconds < 3600) return `${Math.max(1, Math.floor(seconds / 60))} MIN AGO`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} H AGO`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)} D AGO`;
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toUpperCase();
  }

  function clockLabel(iso) {
    try {
      return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch { return ''; }
  }

  function card(item, isNew) {
    const thumb = item.image
      ? `<img src="${escapeHtml(item.image)}" alt="" loading="lazy" decoding="async">`
      : '';
    const flag = isNew ? '<b class="news-flag">NEW</b>' : '';
    return `<a class="news-card${isNew ? ' is-new' : ''}" data-id="${escapeHtml(item.id)}" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">
      <span class="news-thumb" data-mark="${escapeHtml(item.source)}">${thumb}<span class="news-badge">${escapeHtml(item.source)}${flag}</span></span>
      <span class="news-body">
        <time class="news-time" datetime="${escapeHtml(item.published)}">${timeAgo(item.published)}</time>
        <h3 class="news-title">${escapeHtml(item.title)}</h3>
        ${item.summary ? `<p class="news-summary">${escapeHtml(item.summary)}</p>` : ''}
        <span class="news-go">READ AT SOURCE ↗</span>
      </span>
    </a>`;
  }

  function renderSources(sources) {
    if (!sourcesEl) return;
    sourcesEl.innerHTML = sources.map((source) => {
      const title = source.ok
        ? `${source.count} latest from ${source.name}`
        : `${source.name} temporarily unreachable${source.error ? `: ${source.error}` : ''}`;
      return `<span class="news-source${source.ok ? '' : ' is-down'}" title="${escapeHtml(title)}"><i></i>${escapeHtml(source.name)} <b>${source.ok ? source.count : '—'}</b></span>`;
    }).join('');
  }

  function render(data) {
    const items = Array.isArray(data.items) ? data.items : [];
    renderSources(data.sources || []);

    const signature = items.map((item) => item.id).join(',');
    const firstLoad = knownIds === null;
    const fresh = firstLoad ? [] : items.filter((item) => !knownIds.has(item.id));
    knownIds = new Set(items.map((item) => item.id));

    if (signature !== lastSignature || !grid.childElementCount) {
      lastSignature = signature;
      grid.innerHTML = items.map((item) => card(item, !firstLoad && fresh.some((f) => f.id === item.id))).join('');
      // The lead card treatment belongs to the newest story regardless of age.
      const lead = grid.querySelector('.news-card');
      if (lead) lead.classList.add('is-lead');
    }

    // A story can gain its image a tick after it appears (the tunnel reads the
    // article page's preview image), so fill those cards in without a reload.
    for (const item of items) {
      if (!item.image) continue;
      const thumb = grid.querySelector(`.news-card[data-id="${item.id}"] .news-thumb`);
      if (!thumb || thumb.querySelector('img')) continue;
      const img = document.createElement('img');
      img.src = item.image;
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      thumb.prepend(img);
    }

    if (state) {
      if (!items.length) {
        state.hidden = false;
        state.className = 'news-state is-error';
        state.textContent = 'NO STORIES ON THE WIRE YET — THE TUNNEL IS STILL CONNECTING TO ITS SOURCES.';
      } else {
        state.hidden = true;
      }
    }

    const okSources = (data.sources || []).filter((source) => source.ok).length;
    if (updatedEl) {
      updatedEl.textContent = data.updatedAt
        ? `UPDATED ${clockLabel(data.updatedAt)} · ${items.length} STORIES · ${okSources}/${(data.sources || []).length} SOURCES LIVE`
        : 'CONNECTING TO THE NEWS TUNNEL…';
    }

    if (!firstLoad && fresh.length) toast(`${fresh.length} new ${fresh.length === 1 ? 'story' : 'stories'} — feed updated.`);

    // Keep the relative timestamps honest without re-rendering the grid.
    clearInterval(clockTimer);
    clockTimer = setInterval(() => {
      grid.querySelectorAll('time.news-time[datetime]').forEach((el) => { el.textContent = timeAgo(el.getAttribute('datetime')); });
    }, 60000);
  }

  async function load(manual) {
    if (busy) return;
    busy = true;
    if (refreshBtn) refreshBtn.disabled = true;
    try {
      const data = await api(`/api/news${manual ? '?refresh=1' : ''}`);
      render(data);
    } catch (error) {
      if (state && !grid.childElementCount) {
        state.hidden = false;
        state.className = 'news-state is-error';
        state.textContent = `THE NEWS TUNNEL IS RECONNECTING — ${String(error.message || error).toUpperCase()}`;
      } else if (grid.childElementCount) {
        toast('Feed check failed — keeping the last headlines.');
      }
    } finally {
      busy = false;
      if (refreshBtn) refreshBtn.disabled = false;
    }
  }

  refreshBtn?.addEventListener('click', () => load(true));

  // The page follows the tunnel: poll while visible, re-sync the moment the tab
  // comes back, and pause while hidden so background tabs stay cheap.
  setInterval(() => { if (!document.hidden) load(false); }, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(false); });

  load(false);
})();
