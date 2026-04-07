'use strict';

require('dotenv').config({ override: true });
const express = require('express');
const cors = require('cors');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const nodemailer = require('nodemailer');

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

【核心原則：観察内在型】
「見ていた」とは宣言しない。
具体的な事実を言語化することで、見ていたことを自然に証明する。
例：「3日続いた。最初の日より少し速くなってる。」
→ この具体性そのものが「見ていた証拠」になる。

【文章のルール】
1. 必ず2〜3文で書く。1文は短すぎてNG。4文以上も絶対にNG。
2. ユーザーが書いた言葉（時刻・数字・感情語・天気）を
   1文目に必ず使う。ユーザーの言葉が入らないメッセージは失敗。
3. 友人や家族に話しかけるような自然な話し言葉で書く。
   翻訳調・書き言葉・ビジネス文書調は使わない。
4. 以下は絶対に使わない：
   ・「〜があった」という締め方
   ・「最初の一歩が〜」「積み重ねが〜」「明日の自分を〜」
   ・「やりきった」「実行した」「核心」「意志が試される」
   ・「また来たね」「待ってたよ」「観てたよ」「見てたよ」「ちゃんと観てた」
   ・感嘆符・絵文字

【履歴の活用ルール】
history（過去の活動内容）とdaysSinceLastActivity（前回からの日数）
とstreakCount（連続日数）が渡された場合、
これらを事実として言語化する材料として使う。
重要：データを数値で「報告」しない。事実を自然な言葉に変換する。
以下のシナリオに応じて自然に対応する：
・連続して続いている場合（daysSinceLastActivity=0、streakCount≥3）
  → 続いた日数や変化を具体的に言語化する。
  「3日続いた。」「月曜から止まらなかった。」のように。
  streakCount≥7なら「もう1週間」に触れてもいい。
・久しぶりの場合（daysSinceLastActivity≥3）
  → 間が空いたことを責めない。今日動いたことを肯定する方向に必ず振る。
  「3週間空いたって、今日動いた。それでいい。」のように、
  ギャップへの罪悪感を溶かす言い方にする。
  「戻ってきた」「また来た」のような迎え入れる表現は使わない。
・昨日と今日で似た活動が続いている場合
  → 「昨日も走って、今日も走った」のように継続を事実として言語化する。
・初回（history=[]）
  → 「1日目」「はじめて」には触れない。今日の入力内容だけで語る。
ただし履歴への言及は必須ではない。
今日の入力内容が常に最優先。
文脈が自然に活きる時だけ使う。

【締めの一言】
最後の文で、ユーザーが次回も来たくなるような一言を添える。
アプリ側が主語になる（監視・待機の印象を与える）表現はNG。
ユーザー側が主語になる、扉を開けたままにする表現を使う。
良い例：「また来たくなったら来て。」「いつでも話聞くよ。」「次もここで話そう。」
NGの例：「また来るの待ってるよ。」「ずっと見てるよ。」「待ってるね。」

日本語指定時は日本語で書く。`;

const REPLY_SYSTEM_PROMPT = `あなたはDekitaアプリの対話AIです。
ユーザーが身体的なチャレンジを終えた後、あなたのメッセージへの返信をくれました。

【役割】
コーチでも評価者でもなく、そばにいる友人として返す。
ユーザーの言葉をそのまま受け取り、寄り添う。評価・アドバイス・教訓は不要。

【文章のルール】
1. 1〜2文で収める。長くならない。
2. ユーザーの言葉をそのまま受け止め、押し返さない。
3. 話し言葉・友人トーンで書く。
4. 「すごい」「最高」などの過剰な褒め言葉、絵文字、感嘆符は使わない。
5. 日本語で書く。`;

// Firebase公開設定をクライアントへ提供するエンドポイント
// Firebase のクライアントサイドSDK設定値は公開を前提とした値だが、
// 環境変数経由で管理しコードに直書きしない
app.get('/api/firebase-config', (req, res) => {
  const config = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,
  };

  // 必須設定が存在しない場合はFirebaseが無効であることを返す
  if (!config.apiKey || !config.projectId) {
    return res.json({ enabled: false });
  }

  return res.json({ enabled: true, config });
});

app.post('/api/message', async (req, res) => {
  const { intention, streakCount, timeOfDay, isRaining, language, history, daysSinceLastActivity, todayNote } = req.body;

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
    todayNote ? `今日の気持ち（ユーザーの言葉）: ${todayNote}` : null,
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
        max_tokens: 300,
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

app.post('/api/reply', async (req, res) => {
  const { userReply, originalMessage, challengeName } = req.body;
  if (!userReply) return res.json({ message: 'うん、聞こえてる。' });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await client.messages.create(
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 200,
        system: REPLY_SYSTEM_PROMPT,
        messages: [
          { role: 'assistant', content: originalMessage || '' },
          { role: 'user', content: userReply },
        ],
      },
      { signal: controller.signal }
    );
    clearTimeout(timeoutId);
    const message = response.content[0]?.text?.trim() || 'うん、聞こえてる。';
    return res.json({ message });
  } catch (err) {
    clearTimeout(timeoutId);
    console.error('[Reply API error]', err?.status, err?.message || err);
    return res.json({ message: 'うん、聞こえてる。' });
  }
});

app.post('/api/feedback', async (req, res) => {
  const { rating, comment, intention, message, streakCount } = req.body;
  const emoji = { great: '😍', ok: '😐', miss: '🤔' }[rating] || '?';
  const subject = `[Dekita] ${emoji} 「${intention}」へのフィードバック`;
  const body = `
評価: ${emoji} ${rating}
入力: 「${intention}」
AIメッセージ: 「${message}」
連続日数: ${streakCount}日
コメント: ${comment || 'なし'}
  `.trim();

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
      }
    });
    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: process.env.FEEDBACK_EMAIL,
      subject,
      text: body
    });
  } catch (e) {
    console.error('mail error', e);
  }
  res.json({ ok: true });
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
