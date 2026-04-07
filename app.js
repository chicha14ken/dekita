'use strict';

const HISTORY_KEY = 'dekita_history';
const MAX_HISTORY = 7;
const RATE_KEY = 'dekita_rate';
const DAILY_LIMIT = 5;
const MAX_CHAT_TURNS = 3;

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
  if (typeof window.saveToFirestore === 'function' && typeof window.isLoggedIn === 'function' && window.isLoggedIn()) {
    window.saveToFirestore(entry);
  }
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
    Object.keys(data).forEach(k => { if (k !== key) delete data[k]; });
    localStorage.setItem(RATE_KEY, JSON.stringify(data));
  } catch {}
}

function isLimitReached() {
  return getTodayCount() >= DAILY_LIMIT;
}

function checkRateLimit() {
  const today = new Date().toISOString().split('T')[0];
  const key = 'dekita_usage_' + today;
  const count = parseInt(localStorage.getItem(key) || '0');
  if (count >= DAILY_LIMIT) return false;
  localStorage.setItem(key, count + 1);
  return true;
}

// ── Fetch ──────────────────────────────────────────────────

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

async function fetchReply(payload) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch('/api/reply', {
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

// ── Chat UI helpers ─────────────────────────────────────────

function appendBubble(type, text) {
  const historyEl = document.getElementById('chatHistory');
  const wrap = document.createElement('div');
  wrap.className = `bubble-wrap ${type}`;

  const bubble = document.createElement('div');
  bubble.className = `bubble ${type}`;
  bubble.textContent = text;

  wrap.appendChild(bubble);
  historyEl.appendChild(wrap);
  autoScroll();
  return wrap;
}

function appendThinkingBubble() {
  const historyEl = document.getElementById('chatHistory');
  const wrap = document.createElement('div');
  wrap.className = 'bubble-wrap ai';
  wrap.id = 'thinkingBubble';

  const bubble = document.createElement('div');
  bubble.className = 'bubble ai thinking';
  bubble.textContent = '考え中…';

  wrap.appendChild(bubble);
  historyEl.appendChild(wrap);
  autoScroll();
}

function removeThinkingBubble() {
  const el = document.getElementById('thinkingBubble');
  if (el) el.remove();
}

function autoScroll() {
  const el = document.getElementById('chatHistory');
  if (el) el.scrollTop = el.scrollHeight;
}

function autoResizeTextarea(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

function disableChatInput(placeholderMsg) {
  const inputArea = document.getElementById('chatInputArea');
  const input = document.getElementById('chatInput');
  const btn = document.getElementById('chatSendBtn');
  if (inputArea) inputArea.classList.add('disabled');
  if (input) {
    input.disabled = true;
    if (placeholderMsg) input.placeholder = placeholderMsg;
  }
  if (btn) btn.disabled = true;
}

function applyRateLimitUI() {
  if (isLimitReached()) {
    disableChatInput('今日分はおわりです。また明日。');
  }
}

// ── Timeline ────────────────────────────────────────────────

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

    item.innerHTML = `
      <div class="timeline-dot"></div>
      <div class="timeline-content">
        <div class="timeline-text">${escapeHtml(entry.message)}</div>
        <div class="timeline-meta">
          <span class="timeline-time">${formatTime(entry.timestamp)}</span>
          ${entry.intention ? `<span class="timeline-intention">${escapeHtml(entry.intention)}</span>` : ''}
          ${entry.source === 'fallback' ? '<span class="timeline-source">オフライン</span>' : ''}
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

// ── Main Chat Action ────────────────────────────────────────

let chatTurns = 0;
let lastIntention = '';
let lastMessage = '';

async function sendChat() {
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text) return;

  const sendBtn = document.getElementById('chatSendBtn');

  if (chatTurns === 0 && isLimitReached()) {
    disableChatInput('今日分はおわりです。また明日。');
    return;
  }

  sendBtn.disabled = true;
  input.disabled = true;

  appendBubble('user', text);
  input.value = '';
  autoResizeTextarea(input);

  appendThinkingBubble();

  try {
    let result;

    if (chatTurns === 0) {
      const canUseAI = checkRateLimit();
      if (!canUseAI) {
        const fallbacks = [
          'やり遂げた。\n誰でもなく、自分が。',
          'できた。\nこの一歩が、全てだった。',
          '止まらなかった。\nそれだけで十分。',
        ];
        result = { message: fallbacks[Math.floor(Math.random() * fallbacks.length)], source: 'fallback' };
      } else {
        const timeOfDay = getTimeOfDay();
        const streakCount = getStreakCount();
        const rawHistory = loadHistory();
        const history = rawHistory.slice(0, 7).map(h => ({
          intention: h.intention,
          daysAgo: Math.floor((Date.now() - new Date(h.timestamp).getTime()) / (1000 * 60 * 60 * 24)),
        }));
        const daysSinceLastActivity = history.length > 0 ? history[0].daysAgo : null;

        result = await fetchMessage({
          intention: text,
          streakCount,
          timeOfDay,
          isRaining: false,
          language: 'ja',
          history,
          daysSinceLastActivity,
        });
      }

      saveHistory({
        id: Date.now(),
        intention: text,
        message: result.message,
        timestamp: new Date().toISOString(),
        source: result.source || 'ai',
      });
      incrementTodayCount();

      lastIntention = text;
      lastMessage = result.message;

      if (window.va) window.va('event', { name: 'challenge_submit' });

      const updatedHistory = loadHistory();
      if (updatedHistory.length === 3) {
        setTimeout(() => showFeedbackArea(), 2000);
      }

    } else {
      result = await fetchReply({
        userReply: text,
        originalMessage: lastMessage,
        challengeName: lastIntention,
      });
      lastMessage = result.message;
    }

    removeThinkingBubble();
    appendBubble('ai', result.message);
    chatTurns++;

    if (window.va) window.va('event', { name: 'message_received' });

    if (chatTurns >= MAX_CHAT_TURNS || isLimitReached()) {
      disableChatInput(isLimitReached() ? '今日分はおわりです。また明日。' : 'また話しかけてきて。');
    } else {
      sendBtn.disabled = false;
      input.disabled = false;
      input.focus();
    }

  } catch {
    removeThinkingBubble();
    appendBubble('ai', 'うまく届きませんでした。もう一度試してみてください。');
    sendBtn.disabled = false;
    input.disabled = false;
  }
}

// ── Feedback ──────────────────────────────────────────────

let currentFeedbackRating = null;

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
        comment,
        intention: lastIntention,
        message: lastMessage,
        streakCount: getStreakCount(),
      }),
    });
  } catch (e) {
    console.log('feedback error', e);
  }
  document.getElementById('feedbackArea').innerHTML =
    '<p style="font-size:12px; color:#888;">ありがとうございます。</p>';
}

// ── Tab switching ───────────────────────────────────────────

function switchTab(tab) {
  document.getElementById('viewChat').classList.toggle('hidden', tab !== 'chat');
  document.getElementById('viewHistory').classList.toggle('hidden', tab !== 'history');
  document.getElementById('tabChat').classList.toggle('active', tab === 'chat');
  document.getElementById('tabHistory').classList.toggle('active', tab === 'history');
  if (tab === 'history') renderHistoryView();
}

// ── History View ────────────────────────────────────────────

function renderHistoryView() {
  const history = loadHistory();
  const container = document.getElementById('historyList');
  container.innerHTML = '';

  if (history.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'history-empty';
    empty.textContent = 'まだ記録がありません。';
    container.appendChild(empty);
    return;
  }

  // Group by date
  const grouped = new Map();
  history.forEach(entry => {
    const d = new Date(entry.timestamp);
    const label = d.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' });
    if (!grouped.has(label)) grouped.set(label, []);
    grouped.get(label).push(entry);
  });

  grouped.forEach((entries, dateLabel) => {
    const group = document.createElement('div');
    group.className = 'history-group';

    const dateEl = document.createElement('div');
    dateEl.className = 'history-date';
    dateEl.textContent = dateLabel;
    group.appendChild(dateEl);

    entries.forEach(entry => {
      const entryEl = document.createElement('div');
      entryEl.className = 'history-entry';

      const intention = entry.intention || '';
      const label = intention.length > 30 ? intention.slice(0, 30) + '…' : intention;

      entryEl.innerHTML = `
        <div class="history-ai-msg">${escapeHtml(entry.message || '')}</div>
        <div class="history-meta">
          <span class="history-label">${escapeHtml(label)}</span>
          <span class="history-time">${formatTime(entry.timestamp)}</span>
        </div>
      `;
      group.appendChild(entryEl);
    });

    container.appendChild(group);
  });
}

// ── グローバル公開 ──────────────────────────────────────────

window.renderTimeline = renderHistoryView;

// ── Init ───────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  applyRateLimitUI();

  const chatInput = document.getElementById('chatInput');
  if (chatInput) {
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing && !e.shiftKey) {
        e.preventDefault();
        sendChat();
      }
    });
    chatInput.addEventListener('input', () => {
      autoResizeTextarea(chatInput);
    });
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
});
