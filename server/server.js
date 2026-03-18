'use strict';

require('dotenv').config({ override: true });
const express = require('express');
const cors = require('cors');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

// Fallback messages (Japanese)
const FALLBACK_MESSAGES = [
  { main: 'やり遂げた。', sub: '誰でもなく、自分が。' },
  { main: '山を動かした。', sub: 'そんな日だった。' },
  { main: 'できた。', sub: 'この一歩が、全てだった。' },
  { main: 'なんとかなった。', sub: '自分でそうしたんだ。' },
  { main: '止まらなかった。', sub: 'それだけで十分。' },
];

function getRandomFallback() {
  const item = FALLBACK_MESSAGES[Math.floor(Math.random() * FALLBACK_MESSAGES.length)];
  return `${item.main}\n${item.sub}`;
}

const SYSTEM_PROMPT = `あなたはDekitaアプリのメッセージ生成AIです。
ユーザーが身体的なチャレンジを終えた時に、短いメッセージを送ります。
あなたの役割は「その人のことを知っている友人」です。
励ます必要はありません。
ただ「見ていた」ことを、自然な言葉で伝えてください。
【文章のルール】
1. 必ず1〜2文で収める。3文以上は絶対にNG。
2. ユーザーが書いた言葉（時刻・数字・感情語・天気）を
   1文目に必ず使う。ユーザーの言葉が入らないメッセージは失敗。
3. 友人や家族に話しかけるような自然な話し言葉で書く。
   翻訳調・書き言葉・ビジネス文書調は使わない。
4. 以下は絶対に使わない：
   ・「〜があった」という締め方
   ・「最初の一歩が〜」「積み重ねが〜」「明日の自分を〜」
   ・「やりきった」「実行した」「核心」「意志が試される」
   ・感嘆符・絵文字
【履歴の活用ルール】
history（過去の活動内容）とdaysSinceLastActivity（前回からの日数）
とstreakCount（連続日数）が渡された場合、
これらを「文脈」として丸ごと理解した上で語りかける。
重要：「データを報告する」のではなく「その人の旅を知っている」ように話す。
以下のシナリオに応じて自然に対応する：
・連続して続いている場合（daysSinceLastActivity=0、streakCount≥3）
  → 続いていることを「報告」せず、知っている友人として自然に認識する。
  「また来たね」「今日も出てきたか」のような一言でいい。
  streakCount≥7なら「もう1週間」に触れてもいい。
・久しぶりの場合（daysSinceLastActivity≥3）
  → 再び動き出したこと自体を温かく迎える。
  「〇日ぶりに動いた」でなく「また始めた」「戻ってきた」のトーンで。
・昨日と今日で似た活動が続いている場合
  → 「昨日も走って、今日も走った」のように継続を自然に認識する。
・初回（history=[]）
  → 「1日目」「はじめて」には触れない。今日の入力内容だけで語る。
ただし履歴への言及は必須ではない。
今日の入力内容が常に最優先。
文脈が自然に活きる時だけ使う。
日本語指定時は日本語で書く。`;

app.post('/api/message', async (req, res) => {
  const { intention, streakCount, timeOfDay, isRaining, language, history, daysSinceLastActivity } = req.body;

  const historyLines = Array.isArray(history) && history.length > 0
    ? history.map(h => `  - ${h.daysAgo}日前: ${h.intention}`).join('\n')
    : null;

  const userContent = [
    `今日の活動: ${intention || '身体的チャレンジ'}`,
    `連続日数: ${streakCount || 1}日目`,
    `時間帯: ${timeOfDay || '昼'}`,
    isRaining ? '天気: 雨' : null,
    daysSinceLastActivity != null ? `最後の活動からの日数: ${daysSinceLastActivity}日` : null,
    historyLines ? `過去の活動履歴:\n${historyLines}` : '過去の活動履歴: なし（初回）',
    `言語: ${language || 'ja'}`,
  ]
    .filter(Boolean)
    .join('\n');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await client.messages.create(
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 200,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }],
      },
      { signal: controller.signal }
    );

    clearTimeout(timeoutId);

    const message = response.content[0]?.text?.trim() || getRandomFallback();
    return res.json({ message, source: 'ai' });
  } catch (err) {
    clearTimeout(timeoutId);
    console.error('[API error]', err?.status, err?.message || err);
    return res.json({ message: getRandomFallback(), source: 'fallback' });
  }
});

// Serve index.html for all other routes (Express v5 wildcard syntax)
app.get('*splat', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

// ローカル開発時のみ listen
if (require.main === module) {
  const PORT = process.env.PORT || 3001;

  console.log('API Key loaded:', process.env.ANTHROPIC_API_KEY
    ? process.env.ANTHROPIC_API_KEY.substring(0, 20) + '...'
    : 'NOT FOUND');

  const server = app.listen(PORT, () => {
    console.log(`Dekita server running at http://localhost:${PORT}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use. Kill the other process or change PORT in .env`);
    } else {
      console.error('Server error:', err);
    }
    process.exit(1);
  });
}

// Vercel用エクスポート
module.exports = app;
