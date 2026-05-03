/* ============================================================
   Storage
   ============================================================ */
const STORAGE_KEY = 'runningTracker';
const API_BASE = '';

function loadLocalData() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { sessions: {}, uiState: { collapsed: {} } };
  } catch { return { sessions: {}, uiState: { collapsed: {} } }; }
}

function saveLocalData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

async function loadData() {
  try {
    const res = await fetch(`${API_BASE}/api/sessions`, { credentials: 'same-origin' });
    if (res.ok) {
      const { sessions } = await res.json();
      Object.assign(appData.sessions, sessions);
      saveLocalData(appData);
      renderScheduleTable();
      renderDashboard();
    }
  } catch (_) {}
}

let appData = loadLocalData();

function getSession(id) { return appData.sessions[id] || null; }

async function setSession(id, obj) {
  appData.sessions[id] = obj;
  saveLocalData(appData);
  try {
    await fetch(`${API_BASE}/api/sessions/${id}`, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(obj),
    });
  } catch (_) {}
}

async function clearSession(id) {
  delete appData.sessions[id];
  saveLocalData(appData);
  try {
    await fetch(`${API_BASE}/api/sessions/${id}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
  } catch (_) {}
}

/* ============================================================
   Utilities
   ============================================================ */
function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function parsePlanDate(str) {
  // e.g. "May 4–10" -> parse start date relative to 2026
  const months = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };
  const m = str.match(/^(\w+)\s+(\d+)/);
  if (!m) return null;
  return new Date(2026, months[m[1]], parseInt(m[2]));
}

function getCurrentWeekNum() {
  const today = new Date();
  for (let i = PLAN.weeks.length - 1; i >= 0; i--) {
    const wk = PLAN.weeks[i];
    const start = parsePlanDate(wk.dates);
    if (!start) continue;
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    if (today >= start && today <= end) return wk.num;
    if (today > end && i === PLAN.weeks.length - 1) return wk.num;
  }
  if (today < parsePlanDate(PLAN.weeks[0].dates)) return 1;
  return PLAN.weeks[PLAN.weeks.length - 1].num;
}

function allSessionIds() {
  return PLAN.weeks.flatMap(w => [w.mon.id, w.wed.id, w.sun.id]);
}

function completedCount() {
  return allSessionIds().filter(id => appData.sessions[id]?.completed).length;
}

const ZONE_COLORS = ['#60a5fa', '#34d399', '#f59e0b', '#f97316', '#ef4444'];

/* ============================================================
   Render: Overview
   ============================================================ */
function renderOverview() {
  const grid = document.getElementById('overview-grid');
  const { overview } = PLAN;
  grid.innerHTML = `
    <div class="overview-item">
      <h4>🎯 Sequencing Decision</h4>
      <p>${esc(overview.sequencing)}</p>
    </div>
    <div class="overview-item">
      <h4>📈 Volume Targets</h4>
      <p>${esc(overview.volumeTargets)}</p>
    </div>
    <div class="overview-item">
      <h4>⚡ Intensity Distribution</h4>
      <p>${esc(overview.intensityTarget)}</p>
    </div>
  `;
}

/* ============================================================
   Render: Run Types
   ============================================================ */
function renderRunTypes() {
  const grid = document.getElementById('run-types-grid');
  grid.innerHTML = PLAN.runTypes.map(rt => `
    <div class="run-type-card">
      <div class="run-type-header">
        <div>
          <div class="rt-day">${esc(rt.day)}</div>
          <div class="rt-title">${esc(rt.title)}</div>
        </div>
        <span class="badge ${rt.badgeClass}">${esc(rt.badge)}</span>
      </div>
      <div class="run-type-body">
        <p>${esc(rt.description)}</p>
        <ul>${rt.details.map(d => `<li>${esc(d)}</li>`).join('')}</ul>
        <div class="run-type-meta">
          <div class="meta-pill">
            <span class="mp-label">HR:</span>
            <span class="mp-val">${esc(rt.hrTarget)}</span>
          </div>
          <div class="meta-pill">
            <span class="mp-label">Pace:</span>
            <span class="mp-val">${esc(rt.paceNote)}</span>
          </div>
        </div>
      </div>
    </div>
  `).join('');
}

/* ============================================================
   Render: Blocks
   ============================================================ */
function renderBlocks() {
  const grid = document.getElementById('blocks-grid');
  grid.innerHTML = PLAN.blocks.map(b => `
    <div class="block-card ${b.colorClass}">
      <div class="block-card-header">
        <div class="bc-title">${esc(b.title)}</div>
        <div class="bc-dates">${esc(b.dates)}</div>
      </div>
      <div class="block-card-body">
        <div class="bc-goal">${esc(b.goal)}</div>
        <div class="bc-desc">${esc(b.description)}</div>
        <ul>${b.keyFocus.map(f => `<li>${esc(f)}</li>`).join('')}</ul>
      </div>
      <div class="block-card-footer">
        <div class="bk-stat"><span class="bk-label">Peak: </span><span class="bk-val">${esc(b.peakVolume)}</span></div>
        ${b.deloadWeek ? `<div class="bk-stat"><span class="bk-label">Deload: </span><span class="bk-val">Week ${b.deloadWeek}</span></div>` : ''}
      </div>
    </div>
  `).join('');
}

/* ============================================================
   Render: Schedule Table
   ============================================================ */
function sessionButtonHTML(session, weekNum) {
  const s = getSession(session.id);
  const isCompleted = s?.completed;
  const hasNotes = !!(s?.notes?.trim());
  let cls = 'session-btn';
  if (isCompleted) cls += ' completed';
  else if (hasNotes) cls += ' has-notes';

  const statusText = isCompleted
    ? (s.date ? `Done · ${s.date}` : 'Done')
    : (hasNotes ? 'Has notes' : 'Not logged');

  return `<button class="${cls}" data-id="${esc(session.id)}" data-week="${weekNum}" aria-label="Log session: ${esc(session.label)}">
    <span class="sb-label">${esc(session.label)}</span>
    <span class="sb-status">${statusText}</span>
  </button>`;
}

const BLOCK_ROW_CLASS = { 1: 'block-1-row', 2: 'block-2-row', 3: 'block-3-row', 4: 'block-4-row' };

function renderScheduleTable() {
  const tbody = document.getElementById('schedule-tbody');
  const currentWeek = getCurrentWeekNum();

  tbody.innerHTML = PLAN.weeks.map(wk => {
    const rowClass = [
      BLOCK_ROW_CLASS[wk.block] || '',
      wk.num === currentWeek ? 'current-week-row' : '',
    ].filter(Boolean).join(' ');

    let highlightBadge = '';
    if (wk.highlight === '5K TIME TRIAL') highlightBadge = '<span class="week-highlight-badge amber">5K TIME TRIAL</span>';
    if (wk.highlight === 'PEAK WEEK') highlightBadge = '<span class="week-highlight-badge teal">PEAK WEEK</span>';
    if (wk.highlight === '5K GOAL ATTEMPT') highlightBadge = '<span class="week-highlight-badge green">GOAL ATTEMPT</span>';

    return `<tr class="${rowClass}">
      <td>
        <div class="week-num-cell">
          <div class="wn-num">Week ${wk.num}${wk.num === currentWeek ? ' ◀' : ''}${highlightBadge ? ' ' + highlightBadge : ''}</div>
          <div class="wn-dates">${esc(wk.dates)}</div>
        </div>
      </td>
      <td>${sessionButtonHTML(wk.mon, wk.num)}</td>
      <td>${sessionButtonHTML(wk.wed, wk.num)}</td>
      <td>${sessionButtonHTML(wk.sun, wk.num)}</td>
      <td><div class="week-total-cell">${esc(wk.total)}</div></td>
      <td><div class="week-notes-cell">${esc(wk.notes)}</div></td>
    </tr>`;
  }).join('');

  // Attach click listeners
  tbody.querySelectorAll('.session-btn').forEach(btn => {
    btn.addEventListener('click', () => openModal(btn.dataset.id, parseInt(btn.dataset.week)));
  });
}

/* ============================================================
   Render: Pacing
   ============================================================ */
function renderPacing() {
  const tbody = document.getElementById('pacing-tbody');
  tbody.innerHTML = PLAN.pacing.map((p, i) => `
    <tr>
      <td><span class="zone-dot" style="background:${ZONE_COLORS[i]}"></span>${esc(p.zone)}</td>
      <td><strong>${esc(p.pace)}</strong></td>
      <td>${esc(p.hr)}</td>
      <td style="color:var(--text-muted);font-size:0.82rem">${esc(p.use)}</td>
    </tr>
  `).join('');
}

/* ============================================================
   Render: Key Notes
   ============================================================ */
function renderNotes() {
  const grid = document.getElementById('notes-grid');
  const { watchFor, tradeoffs } = PLAN;

  grid.innerHTML = `
    <div class="notes-card working">
      <h4 class="green">✅ Signs it's working</h4>
      <ul>${watchFor.working.map(s => `<li>${esc(s)}</li>`).join('')}</ul>
    </div>
    <div class="notes-card warning">
      <h4 class="red">⚠️ Signs to dial back</h4>
      <ul>${watchFor.dialBack.map(s => `<li>${esc(s)}</li>`).join('')}</ul>
    </div>
    <div class="notes-card">
      <h4 class="amber">🌡 Heat note</h4>
      <p>${esc(watchFor.heatNote)}</p>
    </div>
    <div class="notes-card" style="grid-column:1/-1">
      <h4 class="navy">⚖️ Key tradeoffs</h4>
      <ul class="tradeoffs-list">
        ${tradeoffs.map(t => `<li>
          <div>
            <div class="td-title">${esc(t.title)}</div>
            <div class="td-detail">${esc(t.detail)}</div>
          </div>
        </li>`).join('')}
      </ul>
    </div>
  `;
}

/* ============================================================
   Render: Dashboard
   ============================================================ */
function renderDashboard() {
  const total = 39;
  const done = completedCount();
  const pct = Math.round((done / total) * 100);
  const currentWeekNum = getCurrentWeekNum();
  const currentWeek = PLAN.weeks.find(w => w.num === currentWeekNum);

  document.getElementById('stat-completed').textContent = done;
  document.getElementById('stat-completed-sub').textContent = `of ${total} sessions`;
  document.getElementById('stat-current-week').textContent = `Week ${currentWeekNum}`;
  document.getElementById('stat-current-dates').textContent = currentWeek?.dates || '';
  document.getElementById('stat-pct').textContent = `${pct}%`;
  document.getElementById('main-pb').style.width = `${pct}%`;
  document.getElementById('pb-pct-label').textContent = `${pct}%`;

  // This week progress
  if (currentWeek) {
    const weekDone = [currentWeek.mon, currentWeek.wed, currentWeek.sun]
      .filter(s => appData.sessions[s.id]?.completed).length;
    document.getElementById('stat-week-done').textContent = `${weekDone}/3`;
  }

  // Next session
  const nextWrap = document.getElementById('next-session-wrap');
  const nextSession = findNextSession();
  if (nextSession) {
    const dayLabel = nextSession.day === 'mon' ? 'Monday (678)' : nextSession.day === 'wed' ? 'Wednesday' : 'Sunday';
    nextWrap.innerHTML = `
      <div class="next-session-card">
        <div class="ns-icon">${nextSession.day === 'mon' ? '⛰' : nextSession.day === 'wed' ? '🌿' : '📏'}</div>
        <div>
          <div class="ns-label">Next session · Week ${nextSession.weekNum}</div>
          <div class="ns-title">${esc(dayLabel)} — ${esc(nextSession.session.label)}</div>
          <div class="ns-detail">${esc(nextSession.session.detail.slice(0, 120))}${nextSession.session.detail.length > 120 ? '…' : ''}</div>
        </div>
      </div>`;
  } else {
    nextWrap.innerHTML = `
      <div class="next-session-card">
        <div class="ns-icon">🏆</div>
        <div>
          <div class="ns-label">All done!</div>
          <div class="ns-title">Plan complete — amazing work.</div>
        </div>
      </div>`;
  }

  // Race goals
  const raceRow = document.getElementById('race-goals-row');
  raceRow.innerHTML = PLAN.overview.raceGoals.map(g => `
    <div class="race-goal-chip">
      <span class="rg-icon">🏁</span>
      <span class="rg-text">
        <span class="rg-name">${esc(g.goal)}</span>
        <span class="rg-date">${esc(g.race)} · ${esc(g.date)}</span>
      </span>
    </div>
  `).join('');

  // Sidebar
  document.getElementById('sidebar-count').textContent = `${done} / ${total}`;
  document.getElementById('sidebar-fill').style.width = `${pct}%`;
}

function findNextSession() {
  for (const wk of PLAN.weeks) {
    const slots = [
      { day: 'mon', session: wk.mon },
      { day: 'wed', session: wk.wed },
      { day: 'sun', session: wk.sun },
    ];
    for (const slot of slots) {
      if (!appData.sessions[slot.session.id]?.completed) {
        return { ...slot, weekNum: wk.num };
      }
    }
  }
  return null;
}

/* ============================================================
   Collapsible sections
   ============================================================ */
function initCollapsibles() {
  document.querySelectorAll('.collapse-btn').forEach(btn => {
    const targetId = btn.dataset.target;
    const key = btn.dataset.key;
    const body = document.getElementById(targetId);

    const isCollapsed = appData.uiState?.collapsed?.[key] === true;
    if (isCollapsed) {
      body.classList.add('hidden');
      btn.classList.add('collapsed');
      btn.innerHTML = `<span class="arrow">▾</span> Expand`;
    }

    btn.addEventListener('click', () => {
      const collapsed = body.classList.toggle('hidden');
      btn.classList.toggle('collapsed', collapsed);
      btn.innerHTML = collapsed
        ? `<span class="arrow">▾</span> Expand`
        : `<span class="arrow">▾</span> Collapse`;
      if (!appData.uiState) appData.uiState = {};
      if (!appData.uiState.collapsed) appData.uiState.collapsed = {};
      appData.uiState.collapsed[key] = collapsed;
      saveLocalData(appData);
    });
  });
}

/* ============================================================
   Sidebar active link tracking
   ============================================================ */
function initScrollSpy() {
  const sections = ['dashboard', 'overview', 'run-types', 'blocks', 'schedule', 'pacing', 'notes'];
  const links = document.querySelectorAll('.nav-link, .header-nav a');

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const id = entry.target.id;
        links.forEach(l => {
          l.classList.toggle('active', l.getAttribute('href') === `#${id}`);
        });
      }
    });
  }, { rootMargin: '-30% 0px -60% 0px' });

  sections.forEach(id => {
    const el = document.getElementById(id);
    if (el) observer.observe(el);
  });
}

/* ============================================================
   Mobile hamburger
   ============================================================ */
function initHamburger() {
  const btn = document.getElementById('hamburger');
  const sidebar = document.getElementById('sidebar');

  btn.addEventListener('click', () => sidebar.classList.toggle('open'));

  document.addEventListener('click', e => {
    if (!sidebar.contains(e.target) && e.target !== btn) {
      sidebar.classList.remove('open');
    }
  });
}

/* ============================================================
   Modal
   ============================================================ */
let modalSessionId = null;

function openModal(sessionId, weekNum) {
  modalSessionId = sessionId;

  const wk = PLAN.weeks.find(w => w.num === weekNum);
  let session = null;
  let dayLabel = '';
  if (wk.mon.id === sessionId) { session = wk.mon; dayLabel = 'Monday (678)'; }
  else if (wk.wed.id === sessionId) { session = wk.wed; dayLabel = 'Wednesday'; }
  else if (wk.sun.id === sessionId) { session = wk.sun; dayLabel = 'Sunday'; }

  if (!session) return;

  document.getElementById('modal-week-label').textContent = `Week ${weekNum} · ${wk.dates}`;
  document.getElementById('modal-session-title').textContent = `${dayLabel} — ${session.label}`;
  document.getElementById('modal-desc').textContent = session.detail;

  const existing = getSession(sessionId);
  const completedEl = document.getElementById('modal-completed');
  const dateEl = document.getElementById('modal-date');
  const notesEl = document.getElementById('modal-notes');

  completedEl.checked = existing?.completed || false;
  dateEl.value = existing?.date || (existing?.completed ? todayISO() : '');
  notesEl.value = existing?.notes || '';

  updateToggleLabel();

  document.getElementById('modal-overlay').classList.add('open');
  notesEl.focus();
}

function updateToggleLabel() {
  const el = document.getElementById('modal-completed');
  const label = document.getElementById('toggle-label-text');
  label.textContent = el.checked ? 'Completed ✓' : 'Mark as completed';
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  modalSessionId = null;
}

async function saveModal() {
  if (!modalSessionId) return;

  const completed = document.getElementById('modal-completed').checked;
  const date = document.getElementById('modal-date').value;
  const notes = document.getElementById('modal-notes').value;
  const saveBtn = document.getElementById('modal-save');

  saveBtn.disabled = true;
  try {
    if (completed || date || notes.trim()) {
      await setSession(modalSessionId, { completed, date: date || null, notes });
    } else {
      await clearSession(modalSessionId);
    }
  } finally {
    saveBtn.disabled = false;
  }

  closeModal();
  renderScheduleTable();
  renderDashboard();
}

async function clearModal() {
  if (!modalSessionId) return;
  if (!confirm('Clear all data for this session?')) return;
  await clearSession(modalSessionId);
  closeModal();
  renderScheduleTable();
  renderDashboard();
}

function initModal() {
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-save').addEventListener('click', saveModal);
  document.getElementById('modal-clear').addEventListener('click', clearModal);

  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-overlay')) closeModal();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.getElementById('modal-overlay').classList.contains('open')) {
      closeModal();
    }
  });

  document.getElementById('modal-completed').addEventListener('change', () => {
    updateToggleLabel();
    // Pre-fill date when toggling to completed
    if (document.getElementById('modal-completed').checked && !document.getElementById('modal-date').value) {
      document.getElementById('modal-date').value = todayISO();
    }
  });
}

/* ============================================================
   Dark Mode
   ============================================================ */
function initDarkMode() {
  const btn = document.getElementById('dark-mode-toggle');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const stored = localStorage.getItem('darkMode');
  const isDark = stored !== null ? stored === 'true' : prefersDark;

  applyDarkMode(isDark);

  btn.addEventListener('click', () => {
    const nowDark = document.documentElement.getAttribute('data-theme') === 'dark';
    applyDarkMode(!nowDark);
    localStorage.setItem('darkMode', String(!nowDark));
  });
}

function applyDarkMode(dark) {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  document.getElementById('dark-mode-toggle').textContent = dark ? '☀️' : '🌙';
}

/* ============================================================
   Init
   ============================================================ */
async function init() {
  renderOverview();
  renderRunTypes();
  renderBlocks();
  renderScheduleTable();
  renderPacing();
  renderNotes();
  renderDashboard();
  initCollapsibles();
  initScrollSpy();
  initHamburger();
  initDarkMode();
  initModal();
  await loadData();
}

document.addEventListener('DOMContentLoaded', init);
