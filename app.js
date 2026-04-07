'use strict';

const HISTORY_KEY = 'dekita_history';
const MAX_HISTORY = 30;
const SESSION_KEY = 'dekita_sessions_total';
const FREE_SESSION_LIMIT = 5;
const MAX_CHAT_TURNS = 5;

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

// ── Session counting ────────────────────────────────────────

function getTotalSessions() {
  return parseInt(localStorage.getItem(SESSION_KEY) || '0');
}

function incrementTotalSessions() {
  localStorage.setItem(SESSION_KEY, getTotalSessions() + 1);
}

function isPaywallReached() {
  return getTotalSessions() >= FREE_SESSION_LIMIT;
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

function showPaywall() {
  const inputArea = document.getElementById('chatInputArea');
  if (!inputArea) return;
  inputArea.innerHTML = `
    <div class="paywall-banner">
      <p class="paywall-text">無料で使える5回を使い切りました。</p>
      <button class="paywall-btn" disabled>有料プランへ（準備中）</button>
    </div>
  `;
}

function applyRateLimitUI() {
  if (isPaywallReached()) {
    showPaywall();
  }
}


function updateHistoryEntry(id, updates) {
  const history = loadHistory();
  const idx = history.findIndex(h => h.id === id);
  if (idx !== -1) {
    history[idx] = { ...history[idx], ...updates };
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  }
}

async function generateAndSaveSummary() {
  if (!currentSessionId || currentSessionTurns.length < 2) return;
  try {
    const res = await fetch('/api/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ turns: currentSessionTurns }),
    });
    const data = await res.json();
    if (data.summary) {
      updateHistoryEntry(currentSessionId, { summary: data.summary });
    }
  } catch {
    // fail silently
  }
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
let currentSessionId = null;
let currentSessionTurns = [];

async function sendChat() {
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text) return;

  const sendBtn = document.getElementById('chatSendBtn');

  if (chatTurns === 0 && isPaywallReached()) {
    showPaywall();
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

      const sessionId = Date.now();
      saveHistory({
        id: sessionId,
        intention: text,
        message: result.message,
        timestamp: new Date().toISOString(),
        source: result.source || 'ai',
      });
      incrementTotalSessions();

      currentSessionId = sessionId;
      currentSessionTurns = [
        { role: 'user', content: text },
        { role: 'ai', content: result.message },
      ];

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
      currentSessionTurns.push({ role: 'user', content: text });
      currentSessionTurns.push({ role: 'ai', content: result.message });
      lastMessage = result.message;
    }

    removeThinkingBubble();
    appendBubble('ai', result.message);
    chatTurns++;

    if (window.va) window.va('event', { name: 'message_received' });

    if (chatTurns >= MAX_CHAT_TURNS) {
      disableChatInput('また話しかけてきて。');
      generateAndSaveSummary();
    } else if (isPaywallReached()) {
      showPaywall();
      generateAndSaveSummary();
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

      const summary = entry.summary || '';
      const fallbackLabel = (entry.intention || '').slice(0, 30) + ((entry.intention || '').length > 30 ? '…' : '');

      entryEl.innerHTML = `
        <div class="history-summary">${escapeHtml(summary || fallbackLabel)}</div>
        <div class="history-ai-msg">${escapeHtml(entry.message || '')}</div>
        <div class="history-meta">
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
