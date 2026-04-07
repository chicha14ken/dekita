'use strict';

// Firebase CDN モジュール（ESM形式）
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js';
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDocs,
  orderBy,
  query,
} from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js';

// ── Firebase初期化 ────────────────────────────────────────

let app = null;
let auth = null;
let db = null;
let firebaseEnabled = false;

async function initFirebase() {
  try {
    const res = await fetch('/api/firebase-config');
    const data = await res.json();
    if (!data.enabled) {
      console.info('[Dekita] Firebase未設定: ゲストモードで動作します');
      return;
    }
    app = initializeApp(data.config);
    auth = getAuth(app);
    db = getFirestore(app);
    firebaseEnabled = true;
    setupAuthStateListener();
  } catch (e) {
    console.warn('[Dekita] Firebase初期化エラー:', e);
  }
}

// ── 認証状態の監視 ────────────────────────────────────────

function setupAuthStateListener() {
  if (!auth) return;
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      updateAuthUI(user);
      await onUserSignedIn(user);
    } else {
      updateAuthUIGuest();
    }
  });
}

// ── UI更新 ────────────────────────────────────────────────

function updateAuthUI(user) {
  const guestEl = document.getElementById('authGuest');
  const userEl = document.getElementById('authUser');
  const avatarEl = document.getElementById('authAvatar');
  const nameEl = document.getElementById('authName');
  if (!guestEl || !userEl) return;

  guestEl.style.display = 'none';
  userEl.style.display = 'flex';

  if (avatarEl && user.photoURL) {
    avatarEl.src = user.photoURL;
    avatarEl.alt = user.displayName || '';
  }
  if (nameEl) {
    nameEl.textContent = user.displayName || user.email || '';
  }
}

function updateAuthUIGuest() {
  const guestEl = document.getElementById('authGuest');
  const userEl = document.getElementById('authUser');
  if (!guestEl || !userEl) return;
  guestEl.style.display = 'flex';
  userEl.style.display = 'none';
}

// ── ログイン・ログアウト ───────────────────────────────────

window.handleGoogleLogin = async function () {
  if (!firebaseEnabled || !auth) {
    alert('Firebaseが設定されていません。管理者にお問い合わせください。');
    return;
  }
  try {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  } catch (e) {
    if (e.code !== 'auth/popup-closed-by-user') {
      console.error('[Dekita] ログインエラー:', e);
    }
  }
};

window.handleLogout = async function () {
  if (!auth) return;
  try {
    await signOut(auth);
  } catch (e) {
    console.error('[Dekita] ログアウトエラー:', e);
  }
};

// ── Firestoreデータ構造 ───────────────────────────────────
// users/{uid}/challenges/{challengeId}

function challengesRef(uid) {
  return collection(db, 'users', uid, 'challenges');
}

// ── ログイン時の処理 ──────────────────────────────────────

async function onUserSignedIn(user) {
  // localStorageにデータがあればFirestoreへマイグレーション
  await migrateLocalStorageToFirestore(user.uid);
  // Firestoreからデータを読み込んでtimelineを再描画
  await loadFromFirestoreAndRender(user.uid);
}

// ── localStorageからFirestoreへのマイグレーション ──────────

async function migrateLocalStorageToFirestore(uid) {
  const HISTORY_KEY = 'dekita_history';
  let localData;
  try {
    localData = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch {
    return;
  }
  if (!localData || localData.length === 0) return;

  // マイグレーション済みフラグを確認
  const migratedKey = 'dekita_migrated_' + uid;
  if (localStorage.getItem(migratedKey)) return;

  try {
    for (const entry of localData) {
      const entryId = String(entry.id || Date.now());
      const ref = doc(challengesRef(uid), entryId);
      await setDoc(ref, {
        id: entry.id || Date.now(),
        intention: entry.intention || '',
        message: entry.message || '',
        timestamp: entry.timestamp || new Date().toISOString(),
        source: entry.source || 'local',
        migratedFromLocal: true,
      }, { merge: true });
    }
    localStorage.setItem(migratedKey, '1');
    console.info('[Dekita] localStorageのデータをFirestoreへ移行しました');
  } catch (e) {
    console.warn('[Dekita] マイグレーションエラー:', e);
  }
}

// ── Firestoreからデータを読み込む ─────────────────────────

async function loadFromFirestoreAndRender(uid) {
  if (!db) return;
  try {
    const q = query(challengesRef(uid), orderBy('timestamp', 'desc'));
    const snapshot = await getDocs(q);
    const entries = snapshot.docs.map(d => d.data());

    // Firestoreのデータをlocalへ反映
    if (entries.length > 0) {
      const HISTORY_KEY = 'dekita_history';
      localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, 30)));
    }

    // 履歴ビューを再描画
    if (typeof window.renderHistoryView === 'function') {
      window.renderHistoryView();
    }
  } catch (e) {
    console.warn('[Dekita] Firestoreからの読み込みエラー:', e);
  }
}

// ── Firestoreへのチャレンジ保存 ────────────────────────────
// app.jsのsaveHistory後に呼ばれる（window経由でapp.jsからアクセス可能にする）

window.saveToFirestore = async function (entry) {
  if (!firebaseEnabled || !auth || !auth.currentUser || !db) return;
  try {
    const uid = auth.currentUser.uid;
    const entryId = String(entry.id);
    const ref = doc(challengesRef(uid), entryId);
    await setDoc(ref, {
      id: entry.id,
      intention: entry.intention || '',
      message: entry.message || '',
      summary: entry.summary || '',
      timestamp: entry.timestamp || new Date().toISOString(),
      source: entry.source || 'ai',
    });
  } catch (e) {
    console.warn('[Dekita] Firestoreへの保存エラー:', e);
  }
};

// ── 現在ログイン中かどうかを返すヘルパー ─────────────────

window.isLoggedIn = function () {
  return firebaseEnabled && auth && auth.currentUser != null;
};

// ── 起動 ──────────────────────────────────────────────────

initFirebase();
