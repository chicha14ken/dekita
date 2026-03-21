'use strict';

const HISTORY_KEY = 'dekita_history';
const MAX_HISTORY = 7;
const RATE_KEY = 'dekita_rate';
const DAILY_LIMIT = 5;

// ── Utilities ──────────────────────────────────────────────

function getTimeOfDay() {
  const h = new Date().getHours();
  if (h >= 5  && h < 11) return '朝';
  if (h >= 11 && h < 17) return '昼';
  if (h >= 17 && h < 21) return '夕方';
  return '夜';
}

function getStreakCount() {
  const history = loadHistory();
  if (history.length === 0) return 1;

  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();
  const dates = history.map(h => new Date(h.timestamp).toDateString());

  // Count streak from today backwards
  let streak = 1;
  if (dates.includes(today) || dates.includes(yesterday)) {
    const uniqueDates = [...new Set(dates)].sort((a, b) => new Date(b) - new Date(a));
    for (let i = 0; i < uniqueDates.length - 1; i++) {
      const d1 = new Date(uniqueDates[i]);
      const d2 = new Date(uniqueDates[i + 1]);
      const diffDays = Math.round((d1 - d2) / 86400000);
      if (diffDays === 1) streak++;
      else break;
    }
  }
  return streak;
}

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveHistory(entry) {
  const history = loadHistory();
  history.unshift(entry);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
}

function formatTime(isoString) {
  const d = new Date(isoString);
  return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
}

// ── Rate limiting ───────────────────────────────────────────

function getTodayKey() {
  return new Date().toDateString();
}

function getTodayCount() {
  try {
    const data = JSON.parse(localStorage.getItem(RATE_KEY) || '{}');
    return data[getTodayKey()] || 0;
  } catch {
    return 0;
  }
}

function incrementTodayCount() {
  try {
    const data = JSON.parse(localStorage.getItem(RATE_KEY) || '{}');
    const key = getTodayKey();
    data[key] = (data[key] || 0) + 1;
    // Remove old date entries
    Object.keys(data).forEach(k => { if (k !== key) delete data[k]; });
    localStorage.setItem(RATE_KEY, JSON.stringify(data));
  } catch {}
}

function isLimitReached() {
  return getTodayCount() >= DAILY_LIMIT;
}

function applyRateLimitUI() {
  const btn = document.getElementById('yattaBtn');
  if (isLimitReached()) {
    btn.disabled = true;
    showLimitMessage();
  } else {
    btn.disabled = false;
  }
}

function showLimitMessage() {
  const mainEl = document.getElementById('messageMain');
  const subEl  = document.getElementById('messageSub');
  mainEl.className = 'message-main visible limit-msg';
  mainEl.textContent = '今日分のメッセージはおわりです。また明日。';
  subEl.className = 'message-sub';
  subEl.textContent = '';
  document.getElementById('divider').classList.add('visible');
}

// ── Fetch with timeout ─────────────────────────────────────

async function fetchMessage(payload) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch('/api/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error('server error');
    return await res.json();
  } catch {
    clearTimeout(timeoutId);
    throw new Error('fetch failed');
  }
}

// ── UI helpers ─────────────────────────────────────────────

function showThinking() {
  const mainEl = document.getElementById('messageMain');
  const subEl  = document.getElementById('messageSub');
  mainEl.className = 'message-main thinking visible';
  mainEl.textContent = '考え中…';
  subEl.className = 'message-sub';
  subEl.textContent = '';
}

function showMessage(text) {
  const mainEl = document.getElementById('messageMain');
  const subEl  = document.getElementById('messageSub');

  // Split on newline if present (main + sub)
  const parts = text.split('\n');
  const mainText = parts[0] || '';
  const subText  = parts.slice(1).join('\n') || '';

  mainEl.className = 'message-main';
  mainEl.textContent = mainText;
  subEl.className = 'message-sub';
  subEl.textContent = subText;

  // Show divider
  document.getElementById('divider').classList.add('visible');

  // Trigger animation on next frame
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      mainEl.classList.add('visible');
      if (subText) subEl.classList.add('visible');
      // Track message display completion
      if (window.va) window.va('event', { name: 'message_received' });
    });
  });
}

function showFeedbackThanks() {
  const area = document.getElementById('feedbackArea');
  if (!area) return;
  area.innerHTML = '<p style="font-size:12px; color:#888;">ありがとうございます。</p>';
  area.style.transition = '';
  area.style.opacity = '1';
  area.style.display = '';

  setTimeout(() => {
    area.style.transition = 'opacity 0.8s';
    area.style.opacity = '0';
    setTimeout(() => { area.style.display = 'none'; }, 800);
  }, 3000);
}

function triggerRipple(btn) {
  const ripple = document.getElementById('ripple');
  ripple.style.width  = `${btn.offsetWidth}px`;
  ripple.style.height = `${btn.offsetWidth}px`;
  ripple.style.left   = '0px';
  ripple.style.top    = '0px';
  ripple.classList.remove('animate');
  void ripple.offsetWidth; // reflow
  ripple.classList.add('animate');
}

function renderTimeline() {
  const history = loadHistory();
  const container = document.getElementById('timeline');
  container.innerHTML = '';

  if (history.length === 0) return;

  document.getElementById('divider').classList.add('visible');

  history.forEach((entry, i) => {
    const item = document.createElement('div');
    item.className = 'timeline-item';
    item.style.animationDelay = `${i * 60}ms`;

    const parts = entry.message.split('\n');
    const displayText = parts.join('\n');

    item.innerHTML = `
      <div class="timeline-dot"></div>
      <div class="timeline-content">
        <div class="timeline-text">${escapeHtml(displayText)}</div>
        <div class="timeline-meta">
          <span class="timeline-time">${formatTime(entry.timestamp)}</span>
          ${entry.intention ? `<span class="timeline-intention">${escapeHtml(entry.intention)}</span>` : ''}
          ${entry.source === 'fallback' ? '<span class="timeline-source">offline</span>' : ''}
        </div>
      </div>
    `;
    container.appendChild(item);
  });
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Rate limiting ─────────────────────────────────────────

function checkRateLimit() {
  const today = new Date().toISOString().split('T')[0];
  const key = 'dekita_usage_' + today;
  const count = parseInt(localStorage.getItem(key) || '0');
  const DAILY_LIMIT = 5;
  if (count >= DAILY_LIMIT) return false;
  localStorage.setItem(key, count + 1);
  return true;
}

// ── Main action ────────────────────────────────────────────

async function fireYatta() {
  // Rate limit check
  if (isLimitReached()) return;

  const btn       = document.getElementById('yattaBtn');
  const intention = document.getElementById('intention').value.trim();

  // Rate limit check
  const canUseAI = checkRateLimit();
  if (!canUseAI) {
    const fallbacks = [
      ["やり遂げた。", "誰でもなく、自分が。"],
      ["できた。", "この一歩が、全てだった。"],
      ["止まらなかった。", "それだけで十分。"]
    ];
    const pair = fallbacks[Math.floor(Math.random() * fallbacks.length)];
    showMessage(pair[0] + '\n' + pair[1]);
    setTimeout(() => {
      const sub = document.getElementById('messageSub');
      if (sub) sub.textContent = '今日分のメッセージは終わりです。また明日。';
    }, 2000);
    saveHistory({
      id: Date.now(),
      intention: intention || '今日も何かやった',
      message: pair[0] + ' ' + pair[1],
      timestamp: new Date().toISOString(),
      source: 'rate-limited',
    });
    renderTimeline();
    return;
  }

  // Track challenge submission
  if (window.va) window.va('event', { name: 'challenge_submit' });

  // 1. Button animation
  btn.classList.remove('popping');
  void btn.offsetWidth;
  btn.classList.add('popping');
  triggerRipple(btn);
  btn.disabled = true;

  // 2. Show "thinking"
  showThinking();

  // 3. Gather context
  const timeOfDay   = getTimeOfDay();
  const streakCount = getStreakCount();

  // Build history payload from localStorage
  const rawHistory = loadHistory();
  const history = rawHistory.slice(0, 7).map(h => ({
    intention: h.intention,
    daysAgo: Math.floor((Date.now() - new Date(h.timestamp).getTime()) / (1000 * 60 * 60 * 24)),
  }));
  const daysSinceLastActivity = history.length > 0 ? history[0].daysAgo : null;

  // 4. Fetch AI message (3s timeout also set server-side)
  let result;
  try {
    result = await fetchMessage({
      intention,
      streakCount,
      timeOfDay,
      isRaining: false,
      language: 'ja',
      history,
      daysSinceLastActivity,
    });
  } catch {
    result = { message: 'できた。\nここまで来た。', source: 'fallback' };
  }

  // 5. Show message with animation
  showMessage(result.message);

  // 6. Save to localStorage
  const entry = {
    id: Date.now(),
    intention,
    message: result.message,
    timestamp: new Date().toISOString(),
    source: result.source,
  };
  saveHistory(entry);

  // 7. Increment rate limit count
  incrementTodayCount();

  // 8. Re-render timeline
  renderTimeline();

  // 9. Track for feedback
  lastIntention = intention;
  lastMessage = result.message;

  // 10. Reset input field
  document.getElementById('intention').value = '';

  // 11. Show feedback area after 3rd tap
  const updatedHistory = loadHistory();
  if (updatedHistory.length === 3) {
    setTimeout(() => showFeedbackArea(), 1500);
  }

  // 12. Check rate limit — disable button if reached
  if (isLimitReached()) {
    showLimitMessage();
  } else {
    btn.disabled = false;
  }
}

// ── Feedback ──────────────────────────────────────────────

let currentFeedbackRating = null;
let lastIntention = '';
let lastMessage = '';

function showFeedbackArea() {
  const area = document.getElementById('feedbackArea');
  if (area) {
    area.style.display = 'block';
    area.style.opacity = '0';
    setTimeout(() => {
      area.style.transition = 'opacity 0.5s';
      area.style.opacity = '1';
    }, 100);
  }
}

function selectFeedback(rating) {
  currentFeedbackRating = rating;
  const buttons = document.querySelectorAll('#feedbackButtons button');
  buttons.forEach(b => b.style.borderColor = '#ccc');
  const idx = ['great', 'ok', 'miss'].indexOf(rating);
  if (buttons[idx]) buttons[idx].style.borderColor = '#333';
  document.getElementById('feedbackComment').style.display = 'block';
}

async function submitFeedback() {
  const comment = document.getElementById('feedbackText').value;
  if (!currentFeedbackRating) return;
  try {
    await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rating: currentFeedbackRating,
        comment: comment,
        intention: lastIntention,
        message: lastMessage,
        streakCount: getStreakCount()
      })
    });
  } catch (e) {
    console.log('feedback error', e);
  }
  document.getElementById('feedbackArea').innerHTML =
    '<p style="font-size:12px; color:#888;">ありがとうございます。</p>';
}

// ── Init ───────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  renderTimeline();
  applyRateLimitUI();

  // Allow Enter key to trigger
  document.getElementById('intention').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') fireYatta();
  });

  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
});
