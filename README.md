# できた (Dekita)

身体的なチャレンジをやり遂げたとき、ボタンをひとつ押す。
Claude AIがその瞬間だけのメッセージを生成する、シンプルなPWAアプリ。

---

## セットアップ手順

### 1. リポジトリの準備

```bash
git clone <your-repo-url>
cd dekita
# または既存フォルダをそのまま使う
```

### 2. 依存パッケージのインストール

```bash
npm install
```

### 3. 環境変数の設定

```bash
cp .env.example .env
```

`.env` を開き、`ANTHROPIC_API_KEY` に取得済みのAPIキーを貼り付ける：

```
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxx
PORT=3001
```

### 4. サーバー起動

```bash
node server/server.js
```

### 5. ブラウザで開く

```
http://localhost:3001
```

---

## フォルダ構成

```
dekita/
├── index.html        ← メインPWA画面
├── style.css         ← スタイル（モノクローム）
├── app.js            ← フロントエンドロジック
├── manifest.json     ← PWA設定
├── sw.js             ← Service Worker（オフラインキャッシュ）
├── .env.example      ← 環境変数テンプレート
├── .gitignore
├── README.md
└── server/
    └── server.js     ← Node.js + Express プロキシサーバー
```

---

## 使い方

1. 「today's challenge」フィールドに今日のチャレンジを入力（任意）
2. 「やった！」ボタンをタップ
3. AIがコンテキスト（時間帯・連続日数・目標内容）を読んでメッセージを生成
4. 直近5件の履歴がタイムラインに表示される

---

## 注意事項

- **APIキーは絶対に `.env` 以外に書かない。** `.gitignore` で除外済み。
- フロントエンド（`app.js`）はAPIキーを一切知らない設計。
  すべてのClaude API呼び出しは `server/server.js` 経由でのみ行われる。
- API呼び出しが3秒を超えた場合、またはエラー時は自動でフォールバックメッセージを表示。
