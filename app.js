// ── Firebase Config ─────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyDa9plj2Aud57nIozm1wTnDUVguUvR-TVI",
  authDomain: "task-flow-230d3.firebaseapp.com",
  projectId: "task-flow-230d3",
  storageBucket: "task-flow-230d3.firebasestorage.app",
  messagingSenderId: "21819695719",
  appId: "1:21819695719:web:94131182a2fa35cc962ac2",
  measurementId: "G-FZWWDHM69B"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const googleProvider = new firebase.auth.GoogleAuthProvider();

// ── State ──────────────────────────────────────────────
let tasks = [];       // active + pending + idle only
let doneTasks = [];   // done tasks (current page from Firestore)
let doneTotalCount = 0;
let activeId = null;
let tickInterval = null;
let currentUser = null;
let unsubFirestore = null;
let doneLastDoc = null;
let doneFirstDoc = null;
let donePageStack = []; // stack of firstDoc for previous pages
let donePage = 0;
const DONE_PAGE_SIZE = 10;
let doneFilterToday = true;

// ── Helpers ────────────────────────────────────────────
function isToday(timestamp) {
  if (!timestamp) return false;
  const d = new Date(timestamp);
  const now = new Date();
  return d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
}

function fmtTime(ms) {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map(v => String(v).padStart(2, '0')).join(':');
}

function fmtShort(ms) {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}

function getElapsed(task) {
  let total = task.elapsed || 0;
  if (task.status === 'active' && task.startedAt) {
    total += Date.now() - task.startedAt;
  }
  return total;
}

function save() {
  hasUserInteracted = true;
  // Local cache
  localStorage.setItem('taskflow_tasks', JSON.stringify(tasks));
  localStorage.setItem('taskflow_active', activeId || '');
}

function tasksRef() {
  return db.collection('users').doc(currentUser.uid).collection('tasks');
}

// ── Auth ─────────────────────────────────────────────────
function googleLogin() {
  auth.signInWithPopup(googleProvider).catch(err => {
    console.error('Login failed:', err);
    alert('Đăng nhập thất bại: ' + err.message);
  });
}

function logout() {
  auth.signOut();
}

function renderAuthBar() {
  const el = document.getElementById('auth-bar');
  if (currentUser) {
    el.innerHTML = `
      <div class="user-info">
        <img class="user-avatar" src="${escHtml(currentUser.photoURL || '')}" alt="" referrerpolicy="no-referrer" />
        <span class="user-name">${escHtml(currentUser.displayName || currentUser.email)}</span>
      </div>
      <button class="btn-logout" onclick="logout()">Đăng xuất</button>`;
  } else {
    el.innerHTML = '';
  }
}

let syncHideTimer = null;
let hasUserInteracted = false;

function setSyncStatus(status, text) {
  if (!hasUserInteracted) return;
  const el = document.getElementById('sync-status');
  el.className = 'sync-status ' + status;
  el.textContent = text;
  el.style.display = '';
  clearTimeout(syncHideTimer);
  if (status === 'synced') {
    syncHideTimer = setTimeout(() => { el.style.display = 'none'; }, 5000);
  }
}

// ── Firestore Sync (subcollection) ────────────────────
async function saveTask(task) {
  if (!currentUser) return;
  hasUserInteracted = true;
  setSyncStatus('syncing', 'Đang đồng bộ...');
  try {
    await tasksRef().doc(task.id).set(JSON.parse(JSON.stringify(task)));
    setSyncStatus('synced', '✓ Đã đồng bộ');
  } catch (err) {
    console.error('Save task failed:', err);
    setSyncStatus('error', '✕ Lỗi đồng bộ');
  }
}

async function deleteTaskFromFirestore(id) {
  if (!currentUser) return;
  setSyncStatus('syncing', 'Đang đồng bộ...');
  try {
    await tasksRef().doc(id).delete();
    setSyncStatus('synced', '✓ Đã đồng bộ');
  } catch (err) {
    console.error('Delete task failed:', err);
    setSyncStatus('error', '✕ Lỗi đồng bộ');
  }
}

// Cache all done tasks fetched from Firestore
let allDoneCache = [];

async function fetchAllDone() {
  if (!currentUser) return;
  try {
    const snap = await tasksRef().where('status', '==', 'done').get();
    allDoneCache = snap.docs.map(d => d.data());
    // Sort by completedAt desc client-side
    allDoneCache.sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
    doneTotalCount = getFilteredDoneCache().length;
  } catch (err) {
    console.error('Fetch done tasks failed:', err);
  }
}

function getFilteredDoneCache() {
  if (doneFilterToday) {
    return allDoneCache.filter(t => isToday(t.completedAt));
  }
  return allDoneCache;
}

function paginateDone(direction) {
  if (direction === 'next') donePage++;
  else if (direction === 'prev' && donePage > 0) donePage--;
  else donePage = 0;

  const filtered = getFilteredDoneCache();
  doneTotalCount = filtered.length;
  const start = donePage * DONE_PAGE_SIZE;
  doneTasks = filtered.slice(start, start + DONE_PAGE_SIZE);
  renderDone();
}

async function fetchDoneTasks(direction) {
  if (!currentUser) return;
  if (direction === 'first' || allDoneCache.length === 0) {
    await fetchAllDone();
    donePage = 0;
  }
  paginateDone(direction === 'first' ? null : direction);
}

async function fetchDoneCount() {
  // Count is now handled by fetchAllDone
  if (allDoneCache.length === 0) await fetchAllDone();
}

async function searchDoneTasks(keyword) {
  if (!currentUser) return;
  if (!keyword) {
    donePage = 0;
    await fetchAllDone();
    paginateDone(null);
    return;
  }
  const kw = keyword.toLowerCase();
  // Nếu cache rỗng, fetch trước
  if (allDoneCache.length === 0) await fetchAllDone();
  const base = getFilteredDoneCache();
  doneTasks = base.filter(t => t.name.toLowerCase().includes(kw));
  doneTotalCount = doneTasks.length;
  donePage = 0;
  renderDone(true);
}

function listenFirestore() {
  if (unsubFirestore) unsubFirestore();
  if (!currentUser) return;

  // Listen active + pending + idle tasks realtime
  unsubFirestore = tasksRef()
    .where('status', 'in', ['active', 'pending', 'idle'])
    .onSnapshot(snap => {
      tasks = snap.docs.map(d => d.data());
      activeId = null;
      const activeTask = tasks.find(t => t.status === 'active');
      if (activeTask) activeId = activeTask.id;
      // Update local cache
      localStorage.setItem('taskflow_tasks', JSON.stringify(tasks));
      localStorage.setItem('taskflow_active', activeId || '');
      renderActive();
      renderPending();
      renderStats();
    }, err => {
      console.error('Firestore listen error:', err);
      setSyncStatus('error', '✕ Lỗi kết nối');
    });
}

// ── Migration: old format → subcollection ─────────────
async function migrateIfNeeded() {
  if (!currentUser) return;
  const userDoc = await db.collection('users').doc(currentUser.uid).get();
  if (!userDoc.exists) return;
  const data = userDoc.data();
  if (!data.tasks || !Array.isArray(data.tasks) || data.tasks.length === 0) return;

  setSyncStatus('syncing', 'Đang di chuyển dữ liệu...');
  const batch = db.batch();
  for (const task of data.tasks) {
    batch.set(tasksRef().doc(task.id), task);
  }
  // Xóa mảng tasks cũ
  batch.update(db.collection('users').doc(currentUser.uid), {
    tasks: firebase.firestore.FieldValue.delete(),
    activeId: firebase.firestore.FieldValue.delete(),
    migrated: true,
  });
  await batch.commit();
  setSyncStatus('synced', '✓ Đã di chuyển dữ liệu');
}

// ── Auth State Listener ─────────────────────────────────
auth.onAuthStateChanged(async user => {
  currentUser = user;
  renderAuthBar();

  if (user) {
    document.getElementById('auth-wall').style.display = 'none';
    document.getElementById('app-loading').style.display = 'block';
    document.getElementById('app-content').style.display = 'none';
    // Load local cache for instant display
    tasks = JSON.parse(localStorage.getItem('taskflow_tasks') || '[]');
    activeId = localStorage.getItem('taskflow_active') || null;
    // Migrate old format if needed
    await migrateIfNeeded();
    // Listen active/pending realtime
    listenFirestore();
    // Fetch done tasks (first page)
    await fetchDoneTasks('first');
    // Hide loading, show app
    document.getElementById('app-loading').style.display = 'none';
    document.getElementById('app-content').style.display = 'block';
    renderActive();
    renderPending();
    renderStats();
    renderDone();
  } else {
    document.getElementById('auth-wall').style.display = 'block';
    document.getElementById('app-loading').style.display = 'none';
    document.getElementById('app-content').style.display = 'none';
    if (unsubFirestore) {
      unsubFirestore();
      unsubFirestore = null;
    }
    tasks = [];
    doneTasks = [];
    activeId = null;
  }
});

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}


// ── Core Actions ───────────────────────────────────────
function addTask() {
  const input = document.getElementById('task-input');
  const estimateInput = document.getElementById('estimate-input');
  const name = input.value.trim();
  const estimateHours = parseFloat(estimateInput.value) || 0;
  let valid = true;

  input.style.borderColor = '';
  estimateInput.style.borderColor = '';

  if (!name) { input.style.borderColor = 'var(--danger)'; input.focus(); valid = false; }
  if (!valid) return;

  const estimateMs = estimateHours * 3600000;
  const task = {
    id: uid(),
    name,
    status: 'idle',
    elapsed: 0,
    estimateMs: estimateMs || null,
    notified20: false,
    notifiedAt: {},
    startedAt: null,
    createdAt: Date.now(),
    completedAt: null,
  };

  input.value = '';
  estimateInput.value = '';

  // If there's an active task, pause it first
  if (activeId) {
    pauseTask(activeId, false);
  }

  tasks.unshift(task);
  startTask(task.id);
}

function startTask(id) {
  if (activeId && activeId !== id) {
    pauseTask(activeId, false);
  }

  const task = tasks.find(t => t.id === id);
  if (!task) return;
  task.status = 'active';
  task.startedAt = Date.now();
  activeId = id;
  save();
  saveTask(task);
  renderActive();
  renderPending();
  renderStats();
}

function pauseTask(id, doRender = true) {
  const task = tasks.find(t => t.id === id);
  if (!task || task.status !== 'active') return;
  task.elapsed += Date.now() - task.startedAt;
  task.startedAt = null;
  task.status = 'pending';
  if (activeId === id) activeId = null;
  save();
  saveTask(task);
  if (doRender) { renderActive(); renderPending(); renderStats(); }
}

async function doneTask(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  if (task.status === 'active') {
    task.elapsed += Date.now() - task.startedAt;
    task.startedAt = null;
  }
  task.status = 'done';
  task.completedAt = Date.now();
  if (activeId === id) activeId = null;
  tasks = tasks.filter(t => t.id !== id);
  save();
  await saveTask(task);
  renderActive();
  renderPending();
  renderStats();
  // Refresh done list
  await fetchDoneTasks('first');
}

async function deleteTask(id) {
  if (activeId === id) activeId = null;
  const wasDone = !tasks.find(t => t.id === id);
  tasks = tasks.filter(t => t.id !== id);
  save();
  await deleteTaskFromFirestore(id);
  if (wasDone) {
    await fetchDoneTasks('first');
  } else {
    renderActive();
    renderPending();
    renderStats();
  }
}

function resumeTask(id) {
  if (activeId && activeId !== id) {
    pauseTask(activeId, false);
  }
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  task.status = 'active';
  task.startedAt = Date.now();
  activeId = id;
  save();
  saveTask(task);
  renderActive();
  renderPending();
  renderStats();
}

// ── Render ─────────────────────────────────────────────
function startTick() {
  clearInterval(tickInterval);
  const hasPending = tasks.some(t => t.status === 'pending');
  if (activeId || hasPending) {
    tickInterval = setInterval(() => {
      if (activeId) {
        renderActive();
        checkDeadlineNotification();
      }
      if (hasPending) tickPendingSince();
      renderStats();
    }, 1000);
  }
}

function renderActive() {
  startTick();
  const el = document.getElementById('active-section');
  const task = activeId ? tasks.find(t => t.id === activeId) : null;

  if (!task || task.status !== 'active') {
    el.innerHTML = `<div class="no-active">
      <div style="font-size:24px;margin-bottom:8px;">⏸</div>
      Chưa có task nào đang chạy.<br>
      Thêm task mới hoặc resume task bị pending.
    </div>`;
    return;
  }

  const elapsed = getElapsed(task);
  el.innerHTML = `
    <div class="active-card">
      <div class="active-label">
        <span class="pulse"></span>
        ĐANG CHẠY
      </div>
      <div class="active-name">${escHtml(task.name)}</div>
      <div class="active-meta">
        <div class="timer-display" id="active-timer">${fmtTime(elapsed)}</div>
        ${task.estimateMs ? (() => {
          const remaining = task.estimateMs - elapsed;
          const color = remaining <= 0 ? 'var(--danger)' : remaining <= task.estimateMs * 0.2 ? 'var(--warn)' : 'var(--success)';
          const text = remaining > 0 ? '⏳ Còn: ' + fmtShort(remaining) : '⚠ Quá hạn: ' + fmtShort(Math.abs(remaining));
          const estHours = (task.estimateMs / 3600000).toFixed(1);
          return `<div style="font-size:14px;color:var(--muted);">Estimate: ${estHours}h</div>
            <div style="font-size:18px;font-weight:600;color:${color};">${text}</div>`;
        })() : ''}
        <span class="status-pill status-active">ACTIVE</span>
      </div>
      <div class="active-actions">
        <button class="btn btn-pause" onclick="pauseTask('${task.id}')">⏸ Pause (nhận task mới)</button>
        <button class="btn btn-done" onclick="doneTask('${task.id}')">✓ Hoàn thành</button>
        <button class="btn btn-danger btn-sm" onclick="deleteTask('${task.id}')">✕</button>
      </div>
    </div>`;
}

function renderPending() {
  const el = document.getElementById('pending-section');
  const pending = tasks.filter(t => t.status === 'pending');

  let html = `<div class="section-header">
    <span class="section-title">// Stack — Đang pending</span>
    <span class="badge">${pending.length} tasks</span>
  </div>`;

  if (pending.length === 0) {
    html += `<div class="task-list"><div class="empty-state">Không có task nào đang bị pending</div></div>`;
  } else {
    html += `<div class="task-list">`;
    pending.forEach((task, i) => {
      const elapsed = getElapsed(task);
      html += `
      <div class="task-item pending">
        <div class="task-info">
          <div class="task-name">${escHtml(task.name)}</div>
          <div class="task-time-info">
            <span class="time-chip elapsed">⏱ Đã làm: ${fmtShort(elapsed)}</span>
            <span class="time-chip pending-time" data-pending-since="${task.startedAt || task.createdAt}">⏳ Pending từ: ${timeSince(task.startedAt || task.createdAt)}</span>
            ${estimateChip(task)}
          </div>
        </div>
        <div class="task-actions">
          <button class="btn btn-ghost btn-sm" onclick="resumeTask('${task.id}')">▶ Resume</button>
          <button class="btn btn-done btn-sm" style="padding:6px 12px;font-size:11px;" onclick="doneTask('${task.id}')">✓</button>
          <button class="btn btn-danger btn-sm" onclick="deleteTask('${task.id}')">✕</button>
        </div>
      </div>`;
    });
    html += `</div>`;
  }

  el.innerHTML = html;
}

function estimateChip(task) {
  if (!task.estimateMs) return '';
  const elapsed = task.elapsed || getElapsed(task);
  const remaining = task.estimateMs - elapsed;
  if (remaining > 0) {
    return `<span class="time-chip" style="color:var(--success);">⏳ Còn: ${fmtShort(remaining)}</span>`;
  }
  return `<span class="time-chip" style="color:var(--danger);">⚠ Quá hạn: ${fmtShort(Math.abs(remaining))}</span>`;
}

function tickPendingSince() {
  document.querySelectorAll('[data-pending-since]').forEach(el => {
    const ts = Number(el.getAttribute('data-pending-since'));
    if (ts) el.textContent = '⏳ Pending từ: ' + timeSince(ts);
  });
}

let doneSearchQuery = '';
let doneSearchTimer = null;

function renderDone(isSearchResult) {
  const el = document.getElementById('done-section');

  if (allDoneCache.length === 0 && !doneSearchQuery) { el.innerHTML = ''; return; }

  const totalPages = isSearchResult ? 1 : Math.ceil(doneTotalCount / DONE_PAGE_SIZE);
  const showingCount = doneTasks.length;

  let html = `<div class="divider"></div>
  <div class="section-header">
    <span class="section-title">// Hoàn thành</span>
    <span class="badge">${doneTotalCount}</span>
  </div>
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
    <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);cursor:pointer;white-space:nowrap;">
      <input type="checkbox" id="done-filter-today" ${doneFilterToday ? 'checked' : ''} />
      Hôm nay
    </label>
    <input type="text" id="done-search" placeholder="Tìm task đã hoàn thành..." value="${escHtml(doneSearchQuery)}" style="flex:1;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:8px 14px;color:var(--text);font-family:'JetBrains Mono',monospace;font-size:12px;outline:none;" />
  </div>
  <div class="task-list">`;

  if (showingCount === 0) {
    html += `<div class="empty-state">Không tìm thấy task nào</div>`;
  } else {
    doneTasks.forEach(task => {
      const elapsed = task.elapsed || 0;
      html += `
      <div class="task-item done">
        <div class="task-info">
          <div class="task-name done-text">${escHtml(task.name)}</div>
          <div class="task-time-info">
            <span class="time-chip">Total: ${fmtShort(elapsed)} (${(elapsed / 3600000).toFixed(2)}h)</span>
              ${estimateChip(task)}
          </div>
        </div>
        <div class="task-actions">
          <button class="btn btn-danger btn-sm" onclick="deleteTask('${task.id}')">✕</button>
        </div>
      </div>`;
    });
  }
  html += `</div>`;

  // Pagination (không hiện khi đang search hoặc chỉ có 1 trang)
  if (!isSearchResult && !doneSearchQuery && totalPages > 1) {
    html += `<div style="display:flex;justify-content:center;align-items:center;gap:12px;margin-top:14px;">
      <button class="btn btn-ghost btn-sm" onclick="goPageDone('prev')" ${donePage === 0 ? 'disabled style="opacity:0.3;pointer-events:none;"' : ''}>← Trước</button>
      <span style="font-size:12px;color:var(--muted);">Trang ${donePage + 1} / ${totalPages}</span>
      <button class="btn btn-ghost btn-sm" onclick="goPageDone('next')" ${donePage >= totalPages - 1 ? 'disabled style="opacity:0.3;pointer-events:none;"' : ''}>Sau →</button>
    </div>`;
  }

  // Lưu vị trí cursor trước khi render lại
  const oldSearch = document.getElementById('done-search');
  const hadFocus = oldSearch && document.activeElement === oldSearch;
  const cursorPos = hadFocus ? oldSearch.selectionStart : null;

  el.innerHTML = html;

  const searchInput = document.getElementById('done-search');
  if (searchInput) {
    searchInput.addEventListener('input', e => {
      doneSearchQuery = e.target.value;
      clearTimeout(doneSearchTimer);
      doneSearchTimer = setTimeout(() => {
        searchDoneTasks(doneSearchQuery);
      }, 500);
    });
    // Khôi phục focus và vị trí cursor
    if (hadFocus) {
      searchInput.focus();
      if (cursorPos !== null) searchInput.setSelectionRange(cursorPos, cursorPos);
    }
  }

  const filterCheckbox = document.getElementById('done-filter-today');
  if (filterCheckbox) {
    filterCheckbox.addEventListener('change', e => {
      doneFilterToday = e.target.checked;
      donePage = 0;
      paginateDone(null);
      renderStats();
    });
  }
}

function toggleDoneFilterToday() {
  doneFilterToday = !doneFilterToday;
  donePage = 0;
  paginateDone(null);
  renderStats();
}

function goPageDone(direction) {
  paginateDone(direction);
}

function renderStats() {
  const active = tasks.find(t => t.status === 'active');
  const pending = tasks.filter(t => t.status === 'pending');

  const activeTotalMs = tasks.reduce((s, t) => s + getElapsed(t), 0);
  const doneTodayMs = allDoneCache
    .filter(t => isToday(t.completedAt))
    .reduce((s, t) => s + (t.elapsed || 0), 0);
  const totalMs = activeTotalMs + doneTodayMs;

  document.getElementById('stat-total').textContent = fmtTime(totalMs);
  document.getElementById('stat-active').textContent = active ? fmtTime(getElapsed(active)) : '—';
  document.getElementById('stat-pending').textContent = pending.length;
  document.getElementById('stat-done').textContent = doneTotalCount;
}

function timeSince(ts) {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  return fmtShort(diff) + ' trước';
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Notifications ────────────────────────────────────────
if ('Notification' in window && Notification.permission === 'default') {
  Notification.requestPermission();
}

function sendNotification(title, body) {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body, icon: 'favicon.png' });
  }
}

function checkDeadlineNotification() {
  const task = activeId ? tasks.find(t => t.id === activeId) : null;
  if (!task || !task.estimateMs) return;
  const elapsed = getElapsed(task);
  const remaining = task.estimateMs - elapsed;
  if (remaining <= 0) return;

  const pct = remaining / task.estimateMs;
  const isLargeTask = task.estimateMs > 1800000; // > 0.5h

  if (!task.notifiedAt) task.notifiedAt = {};

  if (isLargeTask) {
    if (pct <= 0.10 && !task.notifiedAt.p10) {
      task.notifiedAt.p10 = true;
      save();
      sendNotification('TaskFlow — Còn 10% thời gian!', `"${task.name}" chỉ còn ${fmtShort(remaining)}`);
    } else if (pct <= 0.25 && !task.notifiedAt.p25) {
      task.notifiedAt.p25 = true;
      save();
      sendNotification('TaskFlow — Còn 25% thời gian!', `"${task.name}" chỉ còn ${fmtShort(remaining)}`);
    } else if (pct <= 0.50 && !task.notifiedAt.p50) {
      task.notifiedAt.p50 = true;
      save();
      sendNotification('TaskFlow — Còn 50% thời gian', `"${task.name}" chỉ còn ${fmtShort(remaining)}`);
    }
  } else {
    if (pct <= 0.20 && !task.notifiedAt.p20) {
      task.notifiedAt.p20 = true;
      save();
      sendNotification('TaskFlow — Sắp hết thời gian!', `"${task.name}" chỉ còn ${fmtShort(remaining)}`);
    }
  }
}

// ── Clock ──────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  document.getElementById('live-clock').textContent =
    now.toLocaleTimeString('vi-VN', { hour12: false });
  document.getElementById('today-date').textContent =
    now.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
}

setInterval(updateClock, 1000);
updateClock();

// ── Cmd/Ctrl+N: focus task input ───────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'N' && e.shiftKey && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) {
    e.preventDefault();
    document.getElementById('task-input').focus();
  }
});

// ── Enter key ──────────────────────────────────────────
document.getElementById('task-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') addTask();
  else e.target.style.borderColor = '';
});

// ── Estimate input: only allow decimal numbers ────────
document.getElementById('estimate-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') { addTask(); return; }
  e.target.style.borderColor = '';
  const allowed = ['Backspace','Delete','Tab','ArrowLeft','ArrowRight','Home','End'];
  if (allowed.includes(e.key)) return;
  if ((e.key === '.' || e.key === ',') && !e.target.value.includes('.') && !e.target.value.includes(',')) {
    e.preventDefault();
    e.target.setRangeText('.', e.target.selectionStart, e.target.selectionEnd, 'end');
    return;
  }
  if (e.key >= '0' && e.key <= '9') return;
  e.preventDefault();
});

// ── Service Worker ─────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}

// ── Starfield ────────────────────────────────────────────
(function() {
  const canvas = document.getElementById('star-canvas');
  const ctx = canvas.getContext('2d');
  let w, h, stars;

  const STAR_COUNT = 80;
  const SPEED = 0.4;
  const colors = [
    [232, 255, 71],   // accent yellow
    [71, 200, 255],   // accent blue
    [255, 255, 255],  // white
  ];

  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
  }

  function createStars() {
    stars = [];
    for (let i = 0; i < STAR_COUNT; i++) {
      stars.push({
        x: Math.random() * w - w / 2,
        y: Math.random() * h - h / 2,
        z: Math.random() * 1000,
        color: colors[Math.floor(Math.random() * colors.length)],
      });
    }
  }

  function draw() {
    ctx.fillStyle = 'rgba(13, 13, 15, 0.25)';
    ctx.fillRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;

    for (const star of stars) {
      star.z -= SPEED;
      if (star.z <= 0.5) {
        star.x = Math.random() * w - w / 2;
        star.y = Math.random() * h - h / 2;
        star.z = 1000;
      }

      const sx = (star.x / star.z) * 300 + cx;
      const sy = (star.y / star.z) * 300 + cy;

      if (sx < -10 || sx > w + 10 || sy < -10 || sy > h + 10) {
        star.x = Math.random() * w - w / 2;
        star.y = Math.random() * h - h / 2;
        star.z = 1000;
        continue;
      }

      const depth = 1 - star.z / 1000;
      const size = depth * 3.5 + 0.5;
      const alpha = depth * 0.7 + 0.1;
      const [r, g, b] = star.color;

      // Outer glow
      const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, size * 4);
      glow.addColorStop(0, `rgba(${r},${g},${b},${alpha * 0.6})`);
      glow.addColorStop(0.15, `rgba(${r},${g},${b},${alpha * 0.3})`);
      glow.addColorStop(0.5, `rgba(${r},${g},${b},${alpha * 0.08})`);
      glow.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.beginPath();
      ctx.arc(sx, sy, size * 4, 0, Math.PI * 2);
      ctx.fillStyle = glow;
      ctx.fill();

      // Core
      ctx.beginPath();
      ctx.arc(sx, sy, size * 0.6, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r},${g},${b},${Math.min(alpha + 0.3, 1)})`;
      ctx.fill();
    }

    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', () => { resize(); createStars(); });
  resize();
  createStars();
  // Clear canvas first
  ctx.fillStyle = '#0d0d0f';
  ctx.fillRect(0, 0, w, h);
  draw();
})();
