// «Gigbook» — веб-версия (для iPhone: Safari → «Поделиться» → «На экран Домой»).
// Та же база Firebase, что у Android-приложения: тот же вход Google, ключи, подписка и заказы.
// Форматы записей совпадают с Android (data/Sync.kt): date — номер дня, startSec/endSec — секунды дня,
// startAt/endAt — «локальные секунды» (день*86400 + секунда дня), updatedAt — мс (побеждает более позднее).
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, getDoc, getDocFromServer, setDoc,
  updateDoc, deleteDoc, collection, onSnapshot, query, where, runTransaction, serverTimestamp, Timestamp, writeBatch, getDocs,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { firebaseConfig, OLD_CONFIG, ADMIN_EMAIL } from './config.js';

const fb = initializeApp(firebaseConfig);
const auth = getAuth(fb);
const db = initializeFirestore(fb, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

// ---------------- мелочи ----------------
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* приватный режим */ } },
};
// время правки — по часам сервера (поправка из проверки подписки), чтобы неверные часы телефона не проигрывали правки
let clockOffset = ls.get('clockOffset', 0);
const nowMs = () => Date.now() + clockOffset;
const stamp = (prev) => Math.max(nowMs(), (prev || 0) + 1);
const newUid = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
// криптостойкий случайный выбор (32 символа — без перекоса: 256 делится на 32)
const part = (n = 4) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => ALPH[b % ALPH.length]).join('');
const DAY_MS = 864e5;
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const WD_LONG = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
const PERSON_STATUS = { THINKING: 'думает', AGREED: 'согласился', REFUSED: 'отказался', NO_ANSWER: 'не дозвонились' };
const CATEGORIES = ['Реквизит', 'Костюмы', 'Дорога', 'Реклама', 'Еда', 'Другое'];

// Дни считаются как в Android: номер дня от 1970-01-01 по местному календарю.
const ed = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
const ymd = (e) => { const t = new Date(e * DAY_MS); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }; };
const todayEd = () => { const n = new Date(); return ed(n.getFullYear(), n.getMonth() + 1, n.getDate()); };
const nowSec = () => { const n = new Date(); return todayEd() * 86400 + n.getHours() * 3600 + n.getMinutes() * 60 + n.getSeconds(); };
const weekday = (e) => (new Date(e * DAY_MS).getUTCDay() + 6) % 7; // 0 = понедельник
const fmtT = (sec) => { const s = ((sec % 86400) + 86400) % 86400; return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}`; };
const parseT = (t) => { const [h, m] = String(t || '').split(':').map(Number); return Number.isFinite(h) ? h * 3600 + (m || 0) * 60 : null; };
const dateText = (e) => { const { m, d } = ymd(e); return `${d} ${MONTHS_GEN[m - 1]}`; };
const dayTitle = (e) => { const t = todayEd(); const pre = e === t ? 'Сегодня, ' : e === t + 1 ? 'Завтра, ' : ''; return `${pre}${dateText(e)}, ${WD_LONG[weekday(e)]}`; };
const isoOf = (e) => { const { y, m, d } = ymd(e); return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; };
const edOfIso = (s) => { const [y, m, d] = String(s).split('-').map(Number); return y ? ed(y, m, d) : null; };
const money = (n) => `${Math.round(n || 0).toLocaleString('ru-RU')} ₽`;
const short = (n) => Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(Math.abs(n) >= 10000 ? 0 : 1).replace('.', ',')}к` : String(n);
const hoursText = (h) => `${(Math.round(h * 10) / 10).toString().replace('.', ',')} ч`;
const phoneKey = (p) => { const d = String(p || '').replace(/\D/g, ''); if (d.length < 5) return ''; return d.length === 11 && (d[0] === '8' || d[0] === '7') ? d.slice(1) : d; };
const telHref = (p) => { const k = phoneKey(p); return k ? `tel:+${k.length === 10 ? '7' + k : k}` : ''; };

/** Полуоткрытый интервал заказа в «локальных секундах»; конец раньше начала — заказ через полночь. */
const interval = (o) => { const s = o.date * 86400 + o.startSec; let len = o.endSec - o.startSec; if (len < 0) len += 86400; return [s, s + len]; };
const overlaps = (a, b) => a[0] < b[1] && b[0] < a[1];

// ---------------- состояние ----------------
const S = {
  user: null,
  acc: { state: 'checking' },   // checking | signedOut | needKey | disabled | active | expired | member | pending
  orders: new Map(), expenses: new Map(), people: new Map(),
  team: null, members: new Map(), feedOwn: new Map(), feedLoaded: false,
  memberTeam: null, memberFeed: [],
  tab: ls.get('tab', 'cal'),
  view: (() => { const t = ymd(todayEd()); return { y: t.y, m: t.m }; })(),
  sel: todayEd(),
  dayOpen: false,              // открыт экран дня (часы)
  anim: '',                    // сдвиг карточки месяца/дня при листании
  period: 'month',             // «Деньги»: week | month | all
  sheet: null,                 // { type, ... }
  askedDone: false,            // «Заказ был?» — один вопрос за заход
  tapSeq: '',
  filter: { perf: [], places: [], programs: [], q: '' },   // фильтр календаря
};
let unsubs = [];
const stopListeners = () => { unsubs.forEach((u) => { try { u(); } catch { /**/ } }); unsubs = []; };
const canWrite = () => S.acc.state === 'active';
const isTeamOwner = () => S.acc.state === 'active' && (S.acc.admin || S.acc.team) || (S.acc.state === 'expired' && S.acc.team);
const userCol = (name) => collection(db, 'users', S.user.uid, name);

// ---------------- тема ----------------
function applyTheme() {
  let t = ls.get('theme', 'classic');
  if (t === 'princess' && !ls.get('princess', false)) t = 'classic';
  document.documentElement.dataset.theme = t;
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg || '#F2F1EE');
}
applyTheme();

let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}
function needWrite() {
  if (canWrite()) return true;
  toast(S.acc.state === 'member' ? 'Сотрудник может только смотреть' : 'Подписка закончилась — сейчас только просмотр. Продли у владельца.');
  return false;
}

// ---------------- вход и подписка ----------------
onAuthStateChanged(auth, async (u) => {
  S.user = u; stopListeners();
  S.orders.clear(); S.expenses.clear(); S.people.clear(); S.members.clear(); S.feedOwn.clear(); S.team = null; S.memberTeam = null; S.memberFeed = [];
  S.askedDone = false;
  if (!u) { S.acc = { state: 'signedOut' }; render(); return; }
  S.acc = { state: 'checking' }; render();
  await refreshAccount();
});
getRedirectResult(auth).catch((e) => { if (e?.code !== 'auth/no-auth-event') toast('Вход не удался: ' + (e?.message || e)); });

async function login() {
  const p = new GoogleAuthProvider();
  p.setCustomParameters({ prompt: 'select_account' });
  try { await signInWithPopup(auth, p); }
  catch (e) {
    if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/cancelled-popup-request'].includes(e?.code)) await signInWithRedirect(auth, p);
    else if (e?.code !== 'auth/popup-closed-by-user') toast('Вход не удался: ' + (e?.message || e));
  }
}

const OFFLINE_GRACE = 3 * DAY_MS;

/** Как в Android: время берём с сервера; без интернета доверяем последней проверке не дольше 3 дней. */
async function refreshAccount() {
  const u = S.user; if (!u) return;
  const cacheKey = 'acc_' + u.uid;
  try {
    if ((u.email || '').toLowerCase() === ADMIN_EMAIL) {
      S.acc = { state: 'active', until: 4e12, admin: true, team: true, seats: 999 };
    } else {
      const ref = doc(db, 'users', u.uid);
      const snap = await getDocFromServer(ref);
      if (!snap.exists() && await claimMigrated(u)) { await refreshAccount(); return; }
      if (!snap.exists()) {
        // не подписчик — может быть, сотрудник команды
        const ms = await getDocFromServer(doc(db, 'memberships', u.uid)).catch(() => null);
        const owner = ms?.exists() ? ms.data().owner : null;
        if (owner) {
          const m = await getDocFromServer(doc(db, 'teams', owner, 'members', u.uid)).catch(() => null);
          if (m?.exists()) S.acc = { state: m.data().approved ? 'member' : 'pending', owner };
          else { await deleteDoc(doc(db, 'memberships', u.uid)).catch(() => {}); S.acc = { state: 'needKey' }; }
        } else S.acc = { state: 'needKey' };
      } else {
        const d = snap.data();
        await updateDoc(ref, { lastSeen: serverTimestamp() });
        const back = await getDocFromServer(ref);
        const serverNow = back.data().lastSeen?.toMillis?.() || Date.now();
        clockOffset = Math.max(-DAY_MS, Math.min(DAY_MS, serverNow - Date.now())); ls.set('clockOffset', clockOffset);
        const until = d.paidUntil?.toMillis?.() || 0;
        ls.set(cacheKey, { until, disabled: !!d.disabled, team: !!d.team, seats: d.seats || 0, friend: d.friendCode || '', serverNow, at: Date.now() });
        const base = { until, team: !!d.team, seats: d.seats || 0, friend: d.friendCode || '' };
        S.acc = d.disabled ? { state: 'disabled' } : until > serverNow ? { state: 'active', ...base } : { state: 'expired', ...base };
      }
    }
  } catch (e) {
    const c = ls.get(cacheKey, null);
    if (!c) S.acc = { state: 'needKey', offline: true };
    else if (c.disabled) S.acc = { state: 'disabled' };
    else {
      const now = Math.max(Date.now(), c.serverNow + Math.max(0, Date.now() - c.at));
      const ok = c.until > now && now - c.serverNow < OFFLINE_GRACE && Date.now() + 6e5 >= c.at;
      S.acc = { state: ok ? 'active' : 'expired', until: c.until, team: c.team, seats: c.seats, friend: c.friend };
    }
  }
  startData();
  render();
}

// ---------------- переезд со старой базы ----------------
/** Подписка, перенесённая владельцем по почте (migrated/{почта}), — забираем её себе. */
async function claimMigrated(u) {
  const email = (u.email || '').toLowerCase(); if (!email) return false;
  const mref = doc(db, 'migrated', email);
  const m = await getDocFromServer(mref).catch(() => null);
  if (!m?.exists() || m.data().claimedBy) return false;
  const friend = part() + part(2);
  try {
    await runTransaction(db, async (tx) => {
      const cur = await tx.get(mref);
      if (!cur.exists() || cur.data().claimedBy) throw new Error('уже перенесено');
      const d = cur.data();
      const user = { key: 'migrated', email: u.email || '', name: (u.displayName || '').slice(0, 100), paidUntil: d.paidUntil, disabled: !!d.disabled,
        createdAt: d.createdAt || Date.now(), friendCode: friend };
      if (d.team) user.team = true;
      if (d.seats > 0) user.seats = d.seats;
      if (d.backupKey) user.backupKey = d.backupKey;
      tx.set(doc(db, 'users', u.uid), user);
      tx.set(doc(db, 'friendCodes', friend), { uid: u.uid, name: u.displayName || '' });
      tx.update(mref, { claimedBy: u.uid, claimedAt: Date.now() });
    });
    return true;
  } catch { return false; }
}

/** Свои записи из старой базы → в новую (вход тем же Google в старую базу; побеждает более позднее изменение). */
async function importOld() {
  const u = S.user; if (!u || !canWrite()) return;
  const { getApps } = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js');
  const { getFirestore } = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
  const oldApp = getApps().find((a) => a.name === 'old') || initializeApp(OLD_CONFIG, 'old');
  const oldAuth = getAuth(oldApp);
  const p = new GoogleAuthProvider(); p.setCustomParameters({ prompt: 'select_account', login_hint: u.email || '' });
  const r = await signInWithPopup(oldAuth, p);
  if ((r.user.email || '').toLowerCase() !== (u.email || '').toLowerCase()) { await signOut(oldAuth); throw new Error('Выбери ту же почту, что и сейчас: ' + u.email); }
  const odb = getFirestore(oldApp);
  let n = 0;
  for (const name of ['clients', 'orders', 'expenses', 'people']) {
    const old = await getDocs(collection(odb, 'users', r.user.uid, name));
    const cur = await getDocs(collection(db, 'users', u.uid, name));
    const have = new Map(cur.docs.map((d) => [d.id, d.data().updatedAt || 0]));
    let b = writeBatch(db); let inBatch = 0;
    for (const d of old.docs) {
      if ((have.get(d.id) ?? -1) >= (d.data().updatedAt || 0)) continue;
      b.set(doc(db, 'users', u.uid, name, d.id), d.data()); n++;
      if (++inBatch === 400) { await b.commit(); b = writeBatch(db); inBatch = 0; }
    }
    if (inBatch) await b.commit();
  }
  await signOut(oldAuth);
  ls.set('oldImported_' + u.uid, true);
  return n;
}

async function redeem(raw) {
  const u = S.user; const key = String(raw || '').trim().toUpperCase().replace(/\s/g, '');
  if (key.length < 8) return 'Введи ключ целиком';
  const friend = part() + part(2);
  try {
    await runTransaction(db, async (tx) => {
      const kref = doc(db, 'keys', key);
      const uref = doc(db, 'users', u.uid);
      const k = await tx.get(kref);
      const mine = await tx.get(uref);
      if (!k.exists()) throw new Error('Такого ключа нет');
      if (k.data().used === true) throw new Error('Этот ключ уже использован');
      if (mine.exists() && mine.data().disabled === true) throw new Error('Аккаунт отключён — напиши владельцу сервиса');
      const now = Date.now();
      const months = Math.min(24, Math.max(1, k.data().months || 1));
      const team = k.data().team === true;
      tx.update(kref, { used: true, usedBy: u.uid, usedAt: now, usedByEmail: u.email || '', usedByName: u.displayName || '' });
      if (mine.exists()) {
        // подписка уже была: продлеваем от её окончания (или от сегодня)
        const old = mine.data().paidUntil ? mine.data().paidUntil.toMillis() : 0;
        const upd = { key, paidUntil: Timestamp.fromMillis(Math.max(old, now) + months * 31 * DAY_MS) };
        if (team) { upd.team = true; upd.seats = k.data().seats || 0; }
        tx.update(uref, upd);
      } else {
        const user = { key, email: u.email || '', name: (u.displayName || '').slice(0, 100), paidUntil: Timestamp.fromMillis(now + months * 31 * DAY_MS), disabled: false, createdAt: now, friendCode: friend };
        if (team) { user.team = true; user.seats = k.data().seats || 0; }
        tx.set(uref, user);
        tx.set(doc(db, 'friendCodes', friend), { uid: u.uid, name: u.displayName || '' });
      }
    });
    return null;
  } catch (e) {
    const m = String(e?.message || e);
    return /permission/i.test(m) ? 'Сервер не принял ключ. Если подписка уже была — попроси владельца обновить правила базы; иначе проверь дату и время' : m;
  }
}

async function joinTeam(raw) {
  const u = S.user; const code = String(raw || '').trim().toUpperCase().replace(/\s/g, '');
  if (code.length < 6) return 'Введи код команды целиком';
  try {
    const c = await getDoc(doc(db, 'teamCodes', code));
    if (!c.exists()) return 'Такого кода команды нет';
    const owner = c.data().owner;
    if (owner === u.uid) return 'Это код твоей же команды';
    await setDoc(doc(db, 'teams', owner, 'members', u.uid), { name: u.displayName || '', email: u.email || '', code, approved: false, joinedAt: Date.now() });
    await setDoc(doc(db, 'memberships', u.uid), { owner });
    return null;
  } catch (e) { return 'Не получилось: ' + (e?.message || e); }
}

async function leaveTeam() {
  const u = S.user; const owner = S.acc.owner;
  if (owner) await deleteDoc(doc(db, 'teams', owner, 'members', u.uid)).catch(() => {});
  await deleteDoc(doc(db, 'memberships', u.uid)).catch(() => {});
  await refreshAccount();
}

// ---------------- данные ----------------
function listen(q, map, after) {
  unsubs.push(onSnapshot(q, (snap) => {
    snap.docChanges().forEach((ch) => { if (ch.type === 'removed') map.delete(ch.doc.id); else map.set(ch.doc.id, { ...ch.doc.data(), id: ch.doc.id }); });
    after?.(); scheduleRender();
  }, (e) => console.warn(e)));
}

function startData() {
  stopListeners();
  const st = S.acc.state;
  if (st === 'active' || st === 'expired') {
    listen(userCol('orders'), S.orders, () => { maybeAskDone(); schedulePublish(); });
    listen(userCol('expenses'), S.expenses);
    listen(userCol('people'), S.people);
    if (isTeamOwner()) startTeamOwner();
  } else if (st === 'member') {
    const owner = S.acc.owner;
    unsubs.push(onSnapshot(doc(db, 'teams', owner), (t) => {
      S.memberTeam = t.exists() ? t.data() : null;
      // запрос должен совпадать с правилами: «всем» или «назначенные мне»
      unsubs.slice(1).forEach((u) => u()); unsubs.length = 1;
      if (!S.memberTeam) { scheduleRender(); return; }
      const q = S.memberTeam.onlyAssigned
        ? query(collection(db, 'teams', owner, 'feed'), where('assignee', '==', S.user.uid))
        : query(collection(db, 'teams', owner, 'feed'), where('forAll', '==', true));
      unsubs.push(onSnapshot(q, (s) => { S.memberFeed = s.docs.map((d) => ({ ...d.data(), id: d.id })); scheduleRender(); },
        () => { S.memberFeed = []; scheduleRender(); }));
      scheduleRender();
    }, () => scheduleRender()));
  }
}

let renderQueued = false;
function scheduleRender() { if (renderQueued) return; renderQueued = true; requestAnimationFrame(() => { renderQueued = false; render(); }); }

const ordersList = () => [...S.orders.values()];

/** Кто проводит: '' — я, uid — сотрудник, «name:…» — человек по имени. Время занято только у одного и того же (как в Android). */
const performer = (o) => o.assignee ? o.assignee : (o.assigneeName || '').trim() ? 'name:' + o.assigneeName.trim().toLowerCase() : '';

// ---------------- фильтр (как в Android: кто проводит, место, программа, поиск) ----------------
const fkey = (v) => String(v || '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
/** Самые частые значения поля (в том виде, как написаны чаще всего). */
function topValues(list, f) {
  const groups = new Map();
  for (const o of list) { const v = String(f(o) || '').trim().replace(/\s+/g, ' '); if (!v) continue; const k = fkey(v); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(v); }
  return [...groups.values()].sort((a, b) => b.length - a.length).map((vs) => { const c = new Map(); vs.forEach((v) => c.set(v, (c.get(v) || 0) + 1)); return [...c.entries()].sort((a, b) => b[1] - a[1])[0][0]; });
}
const filterActive = () => S.filter.perf.length || S.filter.places.length || S.filter.programs.length || S.filter.q.trim();
function matches(o) {
  const f = S.filter;
  if (f.perf.length && !f.perf.includes(performer(o))) return false;
  if (f.places.length && !f.places.includes(fkey(o.place))) return false;
  if (f.programs.length && !f.programs.includes(fkey(o.program))) return false;
  const q = fkey(f.q);
  if (q) {
    const hay = fkey([o.place, o.address, o.program, o.clientName, o.comment, o.assigneeName].join(' '));
    const dg = q.replace(/\D/g, '');
    if (!hay.includes(q) && !(dg.length >= 4 && String(o.phone || '').replace(/\D/g, '').includes(dg))) return false;
  }
  return true;
}
const shownOrders = () => filterActive() ? ordersList().filter(matches) : ordersList();
function performerName(k) {
  if (!k) return 'Я';
  const m = [...S.members.values()].find((x) => x.id === k); if (m) return m.name || m.email;
  const o = ordersList().find((x) => performer(x) === k); return o?.assigneeName || k.replace(/^name:/, '');
}
function filterLabel() {
  const f = S.filter;
  return [...f.perf.map(performerName), ...f.places.map((p) => p[0].toUpperCase() + p.slice(1)), ...f.programs.map((p) => p[0].toUpperCase() + p.slice(1)), f.q.trim() ? `«${f.q.trim()}»` : ''].filter(Boolean).join(' · ');
}
/** CSV для Excel/Google Таблиц (разделитель «;», метка UTF-8). */
function exportCsv(list) {
  const head = ['Дата', 'Начало', 'Конец', 'Место', 'Адрес', 'Программа', 'Кто проводит', 'Клиент', 'Телефон', 'Цена', 'Комментарий', 'Статус'];
  const st = (x) => x === 'DONE' ? 'выполнен' : x === 'CANCELLED' ? 'отменён' : 'запланирован';
  const d2 = (e) => { const { y, m, d } = ymd(e); return `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}`; };
  const cell = (v) => { const t = String(v ?? ''); return /[;"\n,]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const rows = [head, ...[...list].sort((a, b) => interval(a)[0] - interval(b)[0]).map((o) => [d2(o.date), fmtT(o.startSec), fmtT(o.endSec), o.place, o.address, o.program || '', o.assigneeName || 'Я', o.clientName, o.phone, o.price || '', o.comment, st(o.status)])];
  const blob = new Blob(['\uFEFF' + rows.map((r) => r.map(cell).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `gigbook-${isoOf(todayEd())}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function conflicts(o) {
  if (o.status === 'CANCELLED') return [];
  const iv = interval(o); const who = performer(o);
  return ordersList().filter((x) => x.id !== o.id && x.status !== 'CANCELLED' && performer(x) === who && Math.abs(x.date - o.date) <= 1 && overlaps(iv, interval(x)))
    .sort((a, b) => interval(a)[0] - interval(b)[0]);
}

/** Ближайшее свободное начало в тот же день для заказа той же длины. */
function nextFree(o) {
  let len = o.endSec - o.startSec; if (len < 0) len += 86400;
  const dayStart = o.date * 86400; const dayEnd = dayStart + 86400;
  let t = dayStart + o.startSec;
  const busy = ordersList().filter((x) => x.id !== o.id && x.status !== 'CANCELLED' && performer(x) === performer(o) && Math.abs(x.date - o.date) <= 1).map(interval).sort((a, b) => a[0] - b[0]);
  for (const b of busy) { if (overlaps([t, t + len], b)) t = Math.max(t, b[1]); else if (b[0] >= t + len) break; }
  if (t + len > dayEnd) return null;
  return t - dayStart;
}

async function saveOrder(o, personId) {
  if (!needWrite()) return 'Только просмотр';
  const clash = conflicts(o);
  if (clash.length) return 'Это время занято';
  const old = S.orders.get(o.id);
  const iv = interval(o);
  const data = {
    date: o.date, startSec: o.startSec, endSec: o.endSec, startAt: iv[0], endAt: iv[1],
    place: o.place.trim(), address: o.address.trim(), clientName: o.clientName.trim(), phone: o.phone.trim(),
    price: Number(o.price) || 0, comment: o.comment.trim(), status: o.status || 'ACTIVE',
    lat: Number.isFinite(o.lat) ? o.lat : null, lon: Number.isFinite(o.lon) ? o.lon : null,
    assignee: o.assignee || '', assigneeName: o.assigneeName || '', program: String(o.program || '').trim().slice(0, 100),
    createdAt: old?.createdAt || nowMs(), updatedAt: stamp(old?.updatedAt),
  };
  const id = o.id || newUid();
  try {
    await setDoc(doc(userCol('orders'), id), data, { merge: true });
    if (personId) {
      const p = S.people.get(personId);
      if (p) await setDoc(doc(userCol('people'), personId), { status: 'AGREED', orderUid: id, updatedAt: stamp(p.updatedAt) }, { merge: true });
    }
    S.sel = o.date;
    toast(`Заказ сохранён: ${dateText(o.date)}, ${fmtT(o.startSec)}–${fmtT(o.endSec)}`);
    return null;
  } catch (e) { return 'Не удалось сохранить: ' + (e?.message || e); }
}

async function setStatus(id, status, msg) {
  if (!needWrite()) return;
  const o = S.orders.get(id); if (!o) return;
  await setDoc(doc(userCol('orders'), id), { status, updatedAt: stamp(o.updatedAt) }, { merge: true }).catch((e) => toast('Не получилось: ' + e.message));
  if (msg) toast(msg);
}

// ---------------- «Заказ был?» — один вопрос за заход ----------------
function maybeAskDone() {
  if (S.askedDone || !canWrite() || S.sheet || $('#modal').innerHTML) return;
  const now = nowSec();
  const o = ordersList().filter((x) => x.status === 'ACTIVE' && interval(x)[1] + 900 <= now && interval(x)[1] > now - 3 * 86400)
    .sort((a, b) => interval(a)[1] - interval(b)[1])[0];
  if (!o) return;
  S.askedDone = true;
  $('#modal').innerHTML = `<div class="modal"><div class="card">
    <p class="eyebrow">Заказ закончился</p><h2>Заказ был?</h2>
    <p>${esc(dateText(o.date))}, ${fmtT(o.startSec)}–${fmtT(o.endSec)}<br><span class="muted">${esc([o.place, o.clientName].filter(Boolean).join(' · '))}</span></p>
    <div class="row"><button class="primary grow" data-act="done-yes" data-id="${esc(o.id)}">Был</button><button class="soft grow" style="color:var(--danger)" data-act="done-no" data-id="${esc(o.id)}">Не было</button></div>
    <button class="bg" data-act="modal-close">Спросить в другой раз</button></div></div>`;
}

// ---------------- команда (владелец компании) ----------------
function startTeamOwner() {
  const uid = S.user.uid;
  unsubs.push(onSnapshot(doc(db, 'teams', uid), async (t) => {
    if (!t.exists()) {
      if (!canWrite()) return;
      const code = part() + part(2);
      const name = S.user.displayName || 'Моя команда';
      try {
        await setDoc(doc(db, 'teams', uid), { name, code, range: 'today_tomorrow', onlyAssigned: false, showMoney: false, updatedAt: Date.now() });
        await setDoc(doc(db, 'teamCodes', code), { owner: uid, name });
      } catch (e) { console.warn(e); }
      return;
    }
    S.team = t.data(); schedulePublish(); scheduleRender();
  }, (e) => console.warn(e)));
  listen(collection(db, 'teams', uid, 'members'), S.members, () => {
    // принятым до появления мест — раздать места один раз
    if (canWrite() && !seatsBusy && [...S.members.values()].some((m) => m.approved && !m.seat)) giveSeats();
  });
  unsubs.push(onSnapshot(collection(db, 'teams', uid, 'feed'), (s) => {
    S.feedOwn.clear(); s.docs.forEach((d) => S.feedOwn.set(d.id, d.data())); S.feedLoaded = true; schedulePublish();
  }, (e) => console.warn(e)));
}

const seats = () => S.acc.admin ? 999 : (S.acc.seats || 0);

/** Принять сотрудника = отдать ему свободное место 1…N (запись «место → сотрудник»). false — мест нет. */
async function approveMember(id) {
  try { return await approveWithSeat(id); } catch (e) {
    // старые правила базы (без мест) — принимаем по-старому; место раздастся, когда правила обновят
    if (e?.code !== 'permission-denied') throw e;
    await updateDoc(doc(db, 'teams', S.user.uid, 'members', id), { approved: true });
    return true;
  }
}
async function approveWithSeat(id) {
  const uid = S.user.uid;
  const taken = new Map((await getDocs(collection(db, 'teams', uid, 'seats'))).docs.map((d) => [Number(d.id), d.data().uid]));
  let n = 0;
  for (let i = 1; i <= seats(); i++) if (!taken.get(i) || taken.get(i) === id) { n = i; break; }
  if (!n) return false;
  const b = writeBatch(db);
  b.set(doc(db, 'teams', uid, 'seats', String(n)), { uid: id });
  b.update(doc(db, 'teams', uid, 'members', id), { approved: true, seat: n });
  await b.commit();
  return true;
}
/** Убрать: освободить место (доступ пропадает сразу) и удалить из команды. */
async function removeMember(id) {
  const uid = S.user.uid;
  try { for (const d of (await getDocs(query(collection(db, 'teams', uid, 'seats'), where('uid', '==', id)))).docs) await deleteDoc(d.ref); } catch { /* старые правила */ }
  await deleteDoc(doc(db, 'teams', uid, 'members', id));
}
let seatsBusy = false;
let seatsUnsupported = false;
async function giveSeats() {
  if (seatsUnsupported) return;
  seatsBusy = true;
  // только «новым» способом; при старых правилах базы больше не пытаемся до перезагрузки (иначе запись по кругу)
  try { for (const m of [...S.members.values()].filter((x) => x.approved && !x.seat)) if (!(await approveWithSeat(m.id))) break; }
  catch (e) { seatsUnsupported = true; } finally { seatsBusy = false; }
}
const approvedMembers = () => [...S.members.values()].filter((m) => m.approved);

let publishTimer;
function schedulePublish() { if (!isTeamOwner()) return; clearTimeout(publishTimer); publishTimer = setTimeout(publishFeed, 1500); }

/** Собирает «ленту» для сотрудников: только нужные заказы и только разрешённые поля. */
async function publishFeed() {
  const t = S.team; if (!t || !S.feedLoaded || !canWrite()) return;
  const today = todayEd();
  const to = t.range === 'all' ? Infinity : today + 1;
  const want = new Map();
  for (const o of ordersList()) {
    if (o.status === 'CANCELLED' || o.date < today || o.date > to) continue;
    if (t.onlyAssigned && !o.assignee) continue;
    const d = { date: o.date, startSec: o.startSec, endSec: o.endSec, startAt: o.startAt ?? interval(o)[0], endAt: o.endAt ?? interval(o)[1],
      place: o.place || '', address: o.address || '', lat: o.lat ?? null, lon: o.lon ?? null, comment: o.comment || '',
      clientName: o.clientName || '', status: o.status, assignee: o.assignee || '', assigneeName: o.assigneeName || '', program: o.program || '', forAll: !t.onlyAssigned };
    if (t.showMoney) { d.price = o.price || 0; d.phone = o.phone || ''; }
    want.set(o.id, d);
  }
  const same = (a, b) => JSON.stringify(a, Object.keys(a).sort()) === JSON.stringify(b, Object.keys(b).sort());
  const ops = [];
  for (const [id, d] of want) { const cur = S.feedOwn.get(id); if (!cur || !same(cur, d)) ops.push(['set', id, d]); }
  for (const id of S.feedOwn.keys()) if (!want.has(id)) ops.push(['del', id]);
  for (let i = 0; i < ops.length; i += 300) {
    const b = writeBatch(db);
    ops.slice(i, i + 300).forEach(([k, id, d]) => { const r = doc(db, 'teams', S.user.uid, 'feed', id); if (k === 'set') b.set(r, d); else b.delete(r); });
    await b.commit().catch((e) => console.warn('feed', e));
  }
}

// ---------------- маршрут ----------------
const NAVS = { yandex: 'Яндекс Карты', navi: 'Яндекс Навигатор', dgis: '2ГИС', apple: 'Apple Карты', google: 'Google Карты' };
function routeUrl(app, o) {
  const has = Number.isFinite(o.lat) && Number.isFinite(o.lon);
  const text = encodeURIComponent(o.address || o.place || '');
  switch (app) {
    case 'navi': return has ? `yandexnavi://build_route_on_map?lat_to=${o.lat}&lon_to=${o.lon}` : `yandexnavi://map_search?text=${text}`;
    case 'dgis': return has ? `https://2gis.ru/routeSearch/rsType/car/to/${o.lon},${o.lat}` : `https://2gis.ru/search/${text}`;
    case 'apple': return has ? `https://maps.apple.com/?daddr=${o.lat},${o.lon}&dirflg=d` : `https://maps.apple.com/?daddr=${text}&dirflg=d`;
    case 'google': return `https://www.google.com/maps/dir/?api=1&destination=${has ? `${o.lat},${o.lon}` : text}`;
    default: return has ? `https://yandex.ru/maps/?rtext=~${o.lat},${o.lon}&rtt=auto` : `https://yandex.ru/maps/?text=${text}`;
  }
}
function go(o) {
  if (!o.address && !o.place && !Number.isFinite(o.lat)) { toast('У заказа нет адреса — добавь его, чтобы построить маршрут'); return; }
  const app = ls.get('nav', '');
  if (!app) { openSheet({ type: 'nav', order: o }); return; }
  location.href = routeUrl(app, o);
}

/** Подсказки адреса (OpenStreetMap, Photon), ближе к Пскову — выше. Как в Android. */
async function searchAddress(q) {
  try {
    const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q.slice(0, 150))}&limit=5&lat=57.8136&lon=28.3496`);
    const j = await r.json();
    return (j.features || []).map((f) => {
      const p = f.properties || {}; const [lon, lat] = f.geometry?.coordinates || [];
      const street = [p.street, p.housenumber].filter(Boolean).join(', ');
      return { name: p.name || street || p.city || '', address: [p.name ? street : '', p.city].filter(Boolean).join(', '), lat, lon };
    }).filter((f) => f.name && Number.isFinite(f.lat));
  } catch { return []; }
}

// ---------------- значки (контурные, как в приложении) ----------------
const sv = (d, s = 22) => `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const ICON = {
  cal: sv('<rect x="3" y="4" width="18" height="18" rx="3"/><path d="M16 2v4M8 2v4M3 10h18"/>'),
  people: sv('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>'),
  money: sv('<path d="M22 7 13.5 15.5 8.5 10.5 2 17"/><path d="M16 7h6v6"/>'),
  more: sv('<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"/>'),
  plus: sv('<path d="M12 5v14M5 12h14"/>', 16),
  plus18: sv('<path d="M12 5v14M5 12h14"/>', 18),
  left: sv('<path d="m15 18-6-6 6-6"/>', 20),
  right: sv('<path d="m9 18 6-6-6-6"/>', 20),
  chev: sv('<path d="m9 18 6-6-6-6"/>', 16),
  close: sv('<path d="M18 6 6 18M6 6l12 12"/>', 20),
  check: sv('<path d="M20 6 9 17l-5-5"/>', 14),
  alert: sv('<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>', 20),
  phone: sv('<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>', 18),
  route: sv('<path d="M3 11l19-9-9 19-2-8-8-2z"/>', 20),
  filter: sv('<path d="M4 6h16M7 12h10M10 18h4"/>', 20),
};

// ---------------- мелочи оформления ----------------
const WD_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const cap = (s) => s ? s[0].toUpperCase() + s.slice(1) : s;
const durText = (min) => min < 60 ? `${min} мин` : min % 60 === 0 ? `${min / 60} ч` : min % 60 === 30 ? `${Math.floor(min / 60)},5 ч` : `${Math.floor(min / 60)} ч ${min % 60} мин`;
const ordWord = (n) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'заказ' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'заказа' : 'заказов'}`;
const lenMin = (o) => { const [a, b] = interval(o); return Math.round((b - a) / 60); };
const isDone = (o) => o.status === 'DONE' || interval(o)[1] <= nowSec();
const isNow = (o) => !isDone(o) && interval(o)[0] <= nowSec();
const eyebrowDay = (e) => `${WD_SHORT[weekday(e)]} ${ymd(e).d} ${MONTHS_GEN[ymd(e).m - 1]}`;
const weekStart = () => todayEd() - weekday(todayEd());
const liveOn = (list, e) => list.filter((o) => o.date === e && o.status !== 'CANCELLED').sort((a, b) => a.startSec - b.startSec);

// ---------------- экраны ----------------
function render() {
  applyTheme();
  const st = S.acc.state;
  const full = st === 'active' || st === 'expired';
  document.body.classList.toggle('noTabs', !full);
  $('#banner').innerHTML = banner();
  // экран появляется плавно только когда он сменился; обновления данных не «перезапускают» анимацию
  const scrKey = [st, S.tab, S.dayOpen].join('|');
  $('#main').classList.toggle('noanim', scrKey === S.scrKey); S.scrKey = scrKey;
  $('#tabs').innerHTML = full ? tabs() : '';
  $('#main').innerHTML =
    st === 'checking' ? centerCard('<p class="eyebrow">Gigbook</p><h2>Проверяю доступ…</h2>')
    : st === 'signedOut' ? loginScreen()
    : st === 'needKey' ? keyScreen()
    : st === 'pending' ? pendingScreen()
    : st === 'disabled' ? centerCard(`<h2>Доступ отключён</h2><p class="muted">Владелец приложения отключил этот аккаунт. Свяжитесь с ним, чтобы вернуть доступ.</p>
        <button class="primary full" data-act="recheck">Проверить ещё раз</button><button class="bg" data-act="logout">Выйти из аккаунта</button>`)
    : st === 'member' ? memberScreen()
    : S.tab === 'people' ? peopleScreen() : S.tab === 'money' ? moneyScreen() : S.tab === 'more' ? moreScreen() : S.dayOpen ? dayScreen() : monthScreen();
  S.anim = '';
  // шторки с формами не перерисовываем, чтобы не стереть набранное
  // окно фильтра не перерисовываем, пока в нём печатают (иначе пропадёт курсор)
  if (S.sheet && !S.sheet.form && !(S.sheet.type === 'filter' && document.activeElement?.id === 'fltQ')) $('#sheet').innerHTML = sheetHtml();
  if (full) maybeAskDone();
}

const centerCard = (inner) => `<div class="center"><div class="card">${inner}</div></div>`;
const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const installHint = () => isIos && !standalone
  ? '<p class="small">Чтобы открывать как приложение: внизу Safari нажмите «Поделиться» → «На экран „Домой“».</p>' : '';

function loginScreen() {
  return centerCard(`<p class="eyebrow">Gigbook</p><h1>Все праздники — в одном месте</h1>
    <p class="muted">Войдите тем же Google-аккаунтом, что и в Android-приложении, — заказы будут общие.</p>
    <button class="primary lg" data-act="login">Войти через Google</button>${installHint()}`);
}

function keyScreen() {
  return centerCard(`<p class="eyebrow">Ключ доступа</p><h1>Введите ключ</h1>
    <p class="muted">Ключ выдаёт владелец приложения. Он одноразовый и открывает подписку на месяц.</p>
    ${S.acc.offline ? '<p class="err">Нет связи с сервером — проверьте интернет.</p>' : ''}
    <label class="f">Ключ<input id="keyIn" autocomplete="off" autocapitalize="characters" placeholder="ZK-XXXX-XXXX"></label>
    <p class="err" id="keyErr"></p>
    <button class="primary lg" data-act="redeem">Активировать</button>
    <hr><h3>Я сотрудник компании</h3>
    <p class="small">Попросите у владельца компании код команды. После заявки он подтвердит вас у себя.</p>
    <label class="f">Код команды<input id="teamIn" autocomplete="off" autocapitalize="characters" placeholder="XXXXXX"></label>
    <p class="err" id="teamErr"></p>
    <button class="soft full" data-act="join">Отправить заявку</button>
    <p class="small">Вошли как ${esc(S.user?.email)}</p><button class="bg" data-act="logout">Выйти из аккаунта</button>`);
}

function pendingScreen() {
  return centerCard(`<p class="eyebrow">Команда</p><h1>Заявка отправлена</h1>
    <p class="muted">Владелец компании должен подтвердить вас в разделе «Команда». Потом здесь появятся заказы.</p>
    <button class="primary lg" data-act="recheck">Проверить</button>
    <button class="soft full" data-act="leave">Отменить заявку</button><button class="bg" data-act="logout">Выйти из аккаунта</button>`);
}

function banner() {
  const a = S.acc;
  if (S.user && a.state === 'active' && !a.admin && !ls.get('oldImported_' + S.user.uid, false))
    return `<div class="row wrap">Приложение переехало на новую базу. <button class="soft" data-act="old-import">Перенести мои заказы</button> <button class="bg" data-act="old-skip">Не нужно</button></div>`;
  if (a.state === 'expired') return '<div class="bad" data-act="tab" data-tab="more">Подписка закончилась — только просмотр. Продлите ключом в настройках</div>';
  if (a.state === 'active' && !a.admin && a.until) {
    const left = Math.floor((a.until - Date.now()) / DAY_MS);
    if (left >= 0 && left <= 4) { const t = ymd(Math.floor(a.until / DAY_MS)); return `<div>Подписка до ${t.d} ${MONTHS_GEN[t.m - 1]} — осталось ${left + 1} дн.</div>`; }
  }
  return '';
}

function tabs() {
  const cur = S.tab === 'people' || S.tab === 'money' || S.tab === 'more' ? S.tab : 'cal';
  const b = (id, label) => `<button class="${cur === id ? 'on' : ''}" data-act="tab" data-tab="${id}" ${cur === id ? 'aria-current="page"' : ''}>${ICON[id]}${label}<i></i></button>`;
  return `<nav class="bar" aria-label="Разделы">${b('cal', 'Календарь')}${b('people', 'Люди')}${b('money', 'Деньги')}${b('more', 'Настройки')}</nav>`;
}

/** Строка заказа в списке: время, место, длительность и программа, состояние. */
function orderRow(o, extra = '') {
  const st = o.status === 'CANCELLED' ? 'отменён' : isDone(o) ? 'прошёл' : isNow(o) ? 'идёт' : '';
  const meta = [durText(lenMin(o)), o.program, o.assigneeName ? 'проводит ' + o.assigneeName : '', extra].filter(Boolean).join(' · ');
  return `<button class="lrow" data-act="order" data-id="${esc(o.id)}"><span class="t">${fmtT(o.startSec)}</span>
    <span class="b"><b>${esc(o.place || o.clientName || 'Заказ')}</b><span>${esc(meta)}</span></span>
    ${st ? `<span class="st">${st}</span>` : ''}<span class="chev">${ICON.chev}</span></button>`;
}

function monthScreen() {
  const { y, m } = S.view;
  const t = todayEd();
  const first = ed(y, m, 1); const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const shown = shownOrders().filter((o) => o.status !== 'CANCELLED');
  const byDay = new Map(); let n = 0, sum = 0;
  for (const o of shown) { byDay.set(o.date, (byDay.get(o.date) || 0) + 1); if (o.date >= first && o.date < first + days) { n++; sum += Number(o.price) || 0; } }
  const cells = [];
  for (let i = 0; i < weekday(first); i++) cells.push('<div></div>');
  for (let d = 1; d <= days; d++) {
    const e = first + d - 1; const c = Math.min(3, byDay.get(e) || 0);
    cells.push(`<button class="day ${e === t ? 'today' : ''} ${e < t ? 'past' : ''}" data-act="pick" data-ed="${e}" aria-label="${dateText(e)}, ${c ? ordWord(byDay.get(e)) : 'свободно'}">
      <span class="dn">${d}</span><span class="dots">${'<i></i>'.repeat(c)}</span></button>`);
  }
  const today = liveOn(shown, t);
  const nearest = !today.length ? ordersList().filter((o) => o.status === 'ACTIVE' && interval(o)[0] > nowSec()).sort((a, b) => interval(a)[0] - interval(b)[0])[0] : null;
  const inbox = 0;
  return `<div class="scr">
    <header class="top"><span class="brand" data-act="secretA">${ls.get('theme', 'classic') === 'princess' ? '♡ ' : ''}Gigbook</span>
      <button class="icon" data-act="filter" aria-label="Фильтр заказов" style="${filterActive() ? 'color:var(--primary)' : ''}">${ICON.filter}</button>
      <button class="primary sm" data-act="new" data-ed="${t}">${ICON.plus}Заказ</button></header>
    ${filterActive() ? `<div class="pad" style="margin-bottom:8px"><div class="row"><button class="primary grow" data-act="filter" style="justify-content:flex-start;text-align:left;height:44px">Фильтр: ${esc(filterLabel())}</button>
      <button class="icon ln" data-act="flt-reset" aria-label="Сбросить фильтр">${ICON.close}</button></div></div>` : ''}
    <div class="mwrap" id="mwrap">
      <button class="peek l" data-act="month" data-d="-1" aria-label="Предыдущий месяц"></button>
      <button class="peek r" data-act="month" data-d="1" aria-label="Следующий месяц"></button>
      <section class="card mcard ${S.anim || ''}">
        <div class="mhead"><div><div class="mname"><h1>${MONTHS[m - 1]}</h1><span data-act="secretB">${y}</span></div>
          <div class="msub">${n ? `${ordWord(n)} · ${money(sum)}` : 'Пока нет заказов'}</div></div>
          <div class="marrows"><button class="icon" data-act="month" data-d="-1" aria-label="Предыдущий месяц">${ICON.left}</button>
            <button class="icon" data-act="month" data-d="1" aria-label="Следующий месяц">${ICON.right}</button></div></div>
        <div class="wds mono" aria-hidden="true"><div>ПН</div><div>ВТ</div><div>СР</div><div>ЧТ</div><div>ПТ</div><div>СБ</div><div>ВС</div></div>
        <div class="grid">${cells.join('')}</div>
      </section>
    </div>
    <section class="pad" style="padding-top:20px">
      <div class="row" style="justify-content:space-between"><h2 class="eyebrow">Сегодня · ${WD_SHORT[weekday(t)]} ${ymd(t).d}</h2>
        <button class="bg" style="margin-right:-12px" data-act="open-day" data-ed="${t}">Весь день</button></div>
      ${today.length ? `<div class="card list-card" style="margin-top:6px;overflow:hidden">${today.map((o) => orderRow(o)).join('')}</div>`
        : `<div class="card empty" style="margin-top:6px"><b>Сегодня свободно</b><p style="margin-bottom:14px">Запишите заказ — это займёт минуту.</p>
            <button class="soft" data-act="new" data-ed="${t}">Записать на сегодня</button></div>
          ${nearest ? `<h2 class="eyebrow" style="margin-top:20px">Дальше · ${esc(dayTitle(nearest.date))}</h2>
            <div class="card list-card" style="margin-top:8px;overflow:hidden">${orderRow(nearest)}</div>` : ''}`}
    </section></div>`;
}

/** Свободные окна (от 30 минут) между заказами дня. */
function freeSlots(list, from, to, notBefore = 0) {
  const busy = list.map((o) => { const s = o.startSec / 60; let e = o.endSec / 60; if (e <= s) e = 1440; return [s, e]; }).sort((a, b) => a[0] - b[0]);
  const out = []; let cur = Math.max(from, notBefore);
  for (const [s, e] of busy) { if (s - cur >= 30) out.push([cur, Math.min(s, to)]); cur = Math.max(cur, e); }
  if (to - cur >= 30) out.push([cur, to]);
  return out.filter(([a, b]) => b - a >= 30);
}
const hm = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

function dayScreen() {
  const D = S.sel; const t = todayEd(); const P = D - 1; const N = D + 1;
  const all = ordersList().filter((o) => o.date === D);
  const live = all.filter((o) => o.status !== 'CANCELLED').sort((a, b) => a.startSec - b.startSec);
  const gone = all.filter((o) => o.status === 'CANCELLED');
  const total = live.reduce((s, o) => s + lenMin(o), 0);
  const h0 = Math.min(9, ...live.map((o) => Math.floor(o.startSec / 3600)));
  const h1 = Math.min(24, Math.max(21, ...live.map((o) => o.endSec <= o.startSec ? 24 : Math.ceil(o.endSec / 3600))));
  const from = h0 * 60, to = h1 * 60, H = 44;
  const y = (min) => (min - from) / 60 * H;
  const nowMin = Math.floor((nowSec() % 86400) / 60);
  const nextUp = D === t ? live.find((o) => interval(o)[0] > nowSec()) : null;
  const slots = D < t ? [] : freeSlots(live, from, to, D === t ? Math.ceil((nowMin + 1) / 15) * 15 : 0);
  const hours = []; for (let h = h0; h <= h1; h++) hours.push(`<div class="hr" style="top:${(h - h0) * H}px"><span>${String(h % 24).padStart(2, '0')}:00</span><i></i></div>`);
  const blocks = live.map((o) => {
    const s = Math.max(from, o.startSec / 60); const e = Math.min(to, o.endSec <= o.startSec ? 1440 : o.endSec / 60);
    if (e <= s) return '';
    const done = isDone(o); const compact = e - s < 90; const range = `${fmtT(o.startSec)}–${fmtT(o.endSec)}`;
    const badge = isNow(o) ? 'идёт сейчас' : nextUp && nextUp.id === o.id ? 'через ' + durText(Math.max(1, Math.round((interval(o)[0] - nowSec()) / 60))) : '';
    const name = o.place || o.clientName || 'Заказ';
    return `<button class="blk ${done ? 'done' : 'live'} ${compact ? 'compact' : ''}" data-act="order" data-id="${esc(o.id)}" style="top:${y(s) + 2}px;height:${y(e) - y(s) - 4}px"
      aria-label="${esc(name)}, ${range}${done ? ', прошёл' : ''}"><span style="min-width:0"><span class="t1">${esc(compact ? name + ' · ' + range : name)}</span>
      ${compact ? '' : `<span class="sub">${esc([range, o.clientName, o.assigneeName ? 'проводит ' + o.assigneeName : ''].filter(Boolean).join(' · '))}</span>`}</span>
      ${badge ? `<span class="bdg">${badge}</span>` : ''}${done ? `<span class="row" style="gap:4px;font-size:12px;font-weight:500;flex:none">${ICON.check}Прошёл</span>` : ''}</button>`;
  }).join('');
  const free = slots.map(([a, b]) => {
    const whole = a === from && b === to; const label = whole ? 'Свободно весь день' : 'Свободно ' + durText(b - a);
    return `<button class="free" data-act="new" data-ed="${D}" data-st="${a * 60}" style="top:${y(a) + 2}px;height:${y(b) - y(a) - 4}px" aria-label="Записать заказ на ${hm(a)}">
      ${b - a >= 90 ? `<b>${label}</b><span>${hm(a)}–${hm(b)} · нажмите, чтобы записать</span>` : `<span><b>${label}</b> · ${hm(a)}–${hm(b)}</span>`}</button>`;
  }).join('');
  const nowLine = D === t && nowMin >= from && nowMin <= to ? `<div class="nowl" style="top:${y(nowMin)}px" role="img" aria-label="Сейчас ${hm(nowMin)}"><span>${hm(nowMin)}</span><i></i><em></em></div>` : '';
  return `<div class="scr">
    <header class="top back"><button class="bg" data-act="back-month">${ICON.left}${MONTHS[ymd(D).m - 1]}</button>
      <button class="primary sq" data-act="new" data-ed="${D}" aria-label="Новый заказ на этот день">${ICON.plus18}</button></header>
    ${filterActive() ? `<div class="pad"><button class="primary full" data-act="filter" style="justify-content:flex-start;height:44px">Фильтр: ${esc(filterLabel())}</button></div>` : ''}
    <div class="dwrap" id="dwrap">
      <button class="dpeek l" data-act="day-shift" data-d="-1" aria-label="Предыдущий день"><span class="w mono">${WD_SHORT[weekday(P)].toUpperCase()}</span><span class="n">${ymd(P).d}</span></button>
      <button class="dpeek r" data-act="day-shift" data-d="1" aria-label="Следующий день"><span class="w mono">${WD_SHORT[weekday(N)].toUpperCase()}</span><span class="n">${ymd(N).d}</span></button>
      <section class="card dcard ${D === t ? 'today' : ''} ${S.anim || ''}"><div class="num">${ymd(D).d}</div>
        <div><h1>${cap(WD_LONG[weekday(D)])}</h1><div class="small" style="margin-top:2px">${dateText(D)} · ${live.length ? `${ordWord(live.length)}, ${durText(total)}` : D < t ? 'заказов не было' : 'свободный день'}</div></div></section>
    </div>
    <div class="tl ${S.anim || ''}" style="height:${(h1 - h0) * H + 4}px">${hours.join('')}${free}${blocks}${nowLine}</div>
    ${D < t && !live.length ? '<p class="small" style="margin:8px 20px 0 72px;font-size:14px">В этот день заказов не было.</p>' : ''}
    ${gone.length ? `<section class="pad" style="margin-top:16px"><h2 class="eyebrow">Отменённые и переданные</h2><div class="card list-card" style="margin-top:8px;overflow:hidden">
      ${gone.map((o) => { const tr = String(o.comment || '').startsWith('Передан'); return `<div class="gone"><div class="grow" data-act="order" data-id="${esc(o.id)}" style="cursor:pointer"><s>${esc(o.place || o.clientName || 'Заказ')} · ${fmtT(o.startSec)}</s>
        <span class="small">${tr ? esc(o.comment.split('.')[0]) : 'Отменён'}</span></div>${tr ? '' : `<button class="bg" data-act="restore" data-id="${esc(o.id)}">Вернуть</button>`}</div>`; }).join('')}</div></section>` : ''}
  </div>`;
}

function peopleScreen() {
  const f = S.peopleFilter || 'ALL';
  const all = [...S.people.values()].filter((p) => !p.deleted);
  const list = all.filter((p) => f === 'ALL' || p.status === f).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const chip = (k, t, n) => `<button class="chip ${f === k ? 'on' : ''}" data-act="pfilter" data-f="${k}">${t} <span class="cnt">${n}</span></button>`;
  const stCls = (s) => s === 'AGREED' ? 'st yes' : s === 'REFUSED' || s === 'NO_ANSWER' ? 'st no' : 'st think';
  return `<div class="scr"><header class="top big"><h1>Люди</h1><button class="primary sm" data-act="person-new">${ICON.plus}Человек</button></header>
    <p class="pad small" style="font-size:14px;margin-top:4px">Кто звонил, но ещё не записался. Сюда же попадают черновики из звонков.</p>
    <div class="pad" style="margin-top:14px"><div class="chips scroll">${chip('ALL', 'Все', all.length)}${Object.entries(PERSON_STATUS).map(([k, t]) => chip(k, cap(t), all.filter((p) => p.status === k).length)).join('')}</div></div>
    <div class="pad list" style="margin-top:16px">${list.map((p) => `<article class="card" style="padding:16px;cursor:pointer" data-act="person" data-id="${esc(p.id)}">
      <div class="row" style="justify-content:space-between"><h3 style="font-size:17px">${esc(p.name || p.phone || 'Без имени')}</h3><span class="${stCls(p.status)}">${cap(PERSON_STATUS[p.status] || 'думает')}</span></div>
      <div class="small">${esc([p.approxDate ? '≈ ' + p.approxDate : '', p.budget ? 'до ' + money(p.budget) : '', p.name ? p.phone : ''].filter(Boolean).join(' · '))}</div>
      ${[p.occasion, p.child, p.comment].filter(Boolean).length ? `<p style="margin-top:8px;font-size:15px">${esc([p.occasion, p.child, p.comment].filter(Boolean).join(' · '))}</p>` : ''}
      ${p.callbackAt > 0 ? `<p class="small" style="margin-top:6px;${p.callbackAt < Date.now() ? 'color:var(--danger)' : ''}">Перезвонить ${new Date(p.callbackAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>` : ''}
      ${p.status === 'THINKING' && !p.orderUid ? `<div class="row" style="margin-top:12px"><button class="soft" data-act="person-book" data-id="${esc(p.id)}">Записать в заказы</button><button class="bg" data-act="person-no" data-id="${esc(p.id)}">Отказались</button></div>` : ''}
    </article>`).join('') || `<div class="card empty"><b>${all.length ? 'Здесь пусто' : 'Пока никого нет'}</b><p>${all.length ? 'С таким статусом пока никого нет.' : 'Сюда попадают те, кто звонил и думает, согласился или отказался.'}</p></div>`}</div></div>`;
}

function moneyScreen() {
  const t = todayEd(); const { y, m } = ymd(t); const per = S.period || 'month';
  const wk = weekStart(); const mFrom = ed(y, m, 1); const mTo = ed(y, m + 1, 1) - 1;
  const [from, to] = per === 'week' ? [wk, wk + 6] : per === 'month' ? [mFrom, mTo] : [-1e9, 1e9];
  const live = ordersList().filter((o) => o.status !== 'CANCELLED');
  const inR = live.filter((o) => o.date >= from && o.date <= to);
  const income = inR.reduce((s, o) => s + (Number(o.price) || 0), 0);
  const got = inR.filter(isDone).reduce((s, o) => s + (Number(o.price) || 0), 0);
  const exAll = [...S.expenses.values()].filter((e) => !e.deleted).sort((a, b) => b.date - a.date || (b.createdAt || 0) - (a.createdAt || 0));
  const exps = exAll.filter((e) => e.date >= from && e.date <= to);
  const expSum = exps.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  let groups;
  if (per === 'week') groups = [0, 1, 2, 3, 4, 5, 6].map((i) => ({ label: WD_SHORT[i], a: wk + i, b: wk + i }));
  else if (per === 'month') groups = [[1, 7], [8, 14], [15, 21], [22, 28], [29, mTo - mFrom + 1]].filter(([a, b]) => a <= b).map(([a, b]) => ({ label: `${a}–${b}`, a: mFrom + a - 1, b: mFrom + b - 1 }));
  else { const ks = [...new Set(live.map((o) => { const d = ymd(o.date); return d.y * 12 + d.m - 1; }))].sort((a, b) => a - b).slice(-12);
    groups = ks.map((k) => { const yy = Math.floor(k / 12), mm = k % 12 + 1; return { label: MONTHS[mm - 1].slice(0, 3).toLowerCase(), a: ed(yy, mm, 1), b: ed(yy, mm + 1, 1) - 1 }; }); }
  let max = 1;
  groups.forEach((g) => { g.done = 0; g.plan = 0; live.forEach((o) => { if (o.date >= g.a && o.date <= g.b) { if (isDone(o)) g.done += Number(o.price) || 0; else g.plan += Number(o.price) || 0; } }); max = Math.max(max, g.done + g.plan); });
  const bars = groups.map((g) => { const s = g.done + g.plan; return `<div><div class="v">${s ? (s >= 1000 ? Math.round(s / 1000) + 'к' : s) : ''}</div>
    ${g.plan ? `<div class="p" style="height:${Math.max(3, 108 * g.plan / max)}px"></div>` : ''}${g.done ? `<div class="d" style="height:${Math.max(3, 108 * g.done / max)}px"></div>` : ''}${s ? '' : '<div class="z"></div>'}</div>`; }).join('');
  const cats = Object.entries(exps.reduce((a, e) => { const k = e.category || 'Другое'; a[k] = (a[k] || 0) + (Number(e.amount) || 0); return a; }, {})).sort((a, b) => b[1] - a[1]);
  const top = cats.length > 4 ? [...cats.slice(0, 3), ['Остальное', cats.slice(3).reduce((s, c) => s + c[1], 0)]] : cats;
  const C = 2 * Math.PI * 40; let off = 0;
  const arcs = top.map(([, v], i) => { const len = C * v / Math.max(1, expSum); const a = `<circle cx="52" cy="52" r="40" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" style="stroke:var(--chart-${i + 1})"></circle>`; off += len; return a; }).join('');
  const per2 = per === 'week' ? 'неделю' : per === 'month' ? MONTHS[m - 1].toLowerCase() : 'всё время';
  const future = live.filter((o) => interval(o)[0] > nowSec());
  return `<div class="scr"><header class="top big"><h1>Деньги</h1><button class="primary sm" data-act="expense-new">${ICON.plus}Расход</button></header>
    <div class="pad" style="padding-top:8px">
      <div class="seg" role="group" aria-label="Период">${[['week', 'Неделя'], ['month', 'Месяц'], ['all', 'Всё время']].map(([k, l]) => `<button class="${per === k ? 'on' : ''}" data-act="period" data-p="${k}">${l}</button>`).join('')}</div>
      <section style="padding-top:28px"><h2 class="eyebrow">Прибыль за ${per2}</h2>
        <div class="profit" style="${income - expSum < 0 ? 'color:var(--danger)' : ''}">${money(income - expSum)}</div>
        <div style="margin-top:12px;font-size:14px">доход ${money(income)} − расходы ${money(expSum)}</div>
        <div class="small" style="font-size:14px">${income > got ? `Уже получено ${money(got)}, остальное — по записанным заказам` : 'Всё уже получено'}</div></section>
      <section class="card" style="margin-top:24px;padding:18px 18px 14px">
        <div class="row" style="justify-content:space-between"><h3>${per === 'week' ? 'Доход по дням' : per === 'month' ? 'Доход по неделям' : 'Доход по месяцам'}</h3>
          <div class="leg"><span><span class="sw" style="width:8px;height:8px;border-radius:2px;background:var(--chart-1)"></span>получено</span><span><span class="sw" style="width:8px;height:8px;border-radius:2px;border:1.5px dashed var(--muted)"></span>в планах</span></div></div>
        ${groups.length ? `<div class="bars" role="img" aria-label="${esc(groups.map((g) => `${g.label}: получено ${money(g.done)}, в планах ${money(g.plan)}`).join('; '))}">${bars}</div>
          <div class="blabels" aria-hidden="true">${groups.map((g) => `<div>${g.label}</div>`).join('')}</div>` : '<p class="small" style="margin-top:10px">Заказов пока нет</p>'}
      </section>
      <section class="card" style="margin-top:12px;padding:18px"><h3>Куда ушли расходы</h3>
        ${exps.length ? `<div class="row" style="margin-top:14px;gap:20px"><svg width="104" height="104" viewBox="0 0 104 104" role="img" aria-label="${esc(top.map(([k, v]) => `${k}: ${money(v)}`).join(', '))}" style="flex:none">
            <circle cx="52" cy="52" r="40" fill="none" stroke-width="14" style="stroke:var(--surface-2)"></circle><g transform="rotate(-90 52 52)" fill="none" stroke-width="14">${arcs}</g>
            <text x="52" y="51" text-anchor="middle" font-size="15" font-weight="700" style="fill:var(--fg);font-family:Onest,system-ui">${Math.round(expSum).toLocaleString('ru-RU')}</text>
            <text x="52" y="67" text-anchor="middle" font-size="11" style="fill:var(--muted);font-family:Onest,system-ui">₽ расходов</text></svg>
          <div class="grow" style="display:flex;flex-direction:column;gap:10px;font-size:14px">${top.map(([k, v], i) => `<div class="row" style="gap:8px"><span class="sw" style="background:var(--chart-${i + 1})"></span><span class="grow">${esc(k)}</span><b style="font-weight:500">${money(v)}</b></div>`).join('')}</div></div>`
        : `<p class="small" style="margin:6px 0 12px;font-size:14px">За этот период расходов нет. Добавьте первый — он сразу вычтется из прибыли.</p><button class="soft" data-act="expense-new">Добавить расход</button>`}
      </section>
      ${future.length ? `<section class="card sums" style="margin-top:12px"><div><div class="small">Впереди в этом месяце</div><div class="v">${money(future.filter((o) => o.date <= mTo).reduce((s, o) => s + (Number(o.price) || 0), 0))}</div></div>
        <div><div class="small">Всего записано вперёд</div><div class="v">${money(future.reduce((s, o) => s + (Number(o.price) || 0), 0))} · ${ordWord(future.length)}</div></div></section>` : ''}
      ${exAll.length ? `<section style="margin-top:20px"><h2 class="eyebrow">Последние расходы</h2><div class="card list-card" style="margin-top:8px;overflow:hidden">
        ${exAll.slice(0, 8).map((e) => `<div class="row" style="min-height:60px;padding:8px 4px 8px 16px"><div class="grow"><div style="font-size:15px;font-weight:500">${esc(e.comment || e.category)}</div>
          <div class="small">${esc(e.category)} · ${dateText(e.date)}</div></div><b style="font-weight:500;font-size:15px">−${money(e.amount)}</b>
          <button class="icon" data-act="expense-del" data-id="${esc(e.id)}" aria-label="Удалить расход" style="color:var(--muted)">${ICON.close}</button></div>`).join('')}</div></section>` : ''}
    </div></div>`;
}

function moreScreen() {
  const a = S.acc; const theme = ls.get('theme', 'classic'); const nav = ls.get('nav', '');
  const th = (k, t) => `<button class="${theme === k ? 'on' : ''}" data-act="theme" data-t="${k}">${t}</button>`;
  const until = a.admin ? 'без срока (владелец)' : a.until ? (() => { const t = ymd(Math.floor(a.until / DAY_MS)); return `до ${t.d} ${MONTHS_GEN[t.m - 1]} ${t.y}`; })() : '—';
  return `<div class="scr"><header class="top big"><h1>Настройки</h1></header><div class="pad">
    <section class="sec" style="margin-top:8px"><span class="eyebrow">Аккаунт</span><div class="card" style="padding:16px;display:flex;flex-direction:column;gap:10px">
      <div><div style="font-size:16px;font-weight:500">${esc(S.user?.displayName || S.user?.email || '')}</div><div class="small">${esc(S.user?.email || '')}</div></div>
      <div><div style="font-size:16px;font-weight:500">Подписка ${until}</div><div class="small">${a.team ? `Командная, мест: ${seats() >= 999 ? 'без ограничений' : seats()}` : 'Напомним за 5 дней до конца'}</div></div>
      ${a.friend ? `<p class="small">Код для коллег: <b style="color:var(--fg)">${esc(a.friend)}</b></p>` : ''}
      ${!a.admin ? `<label class="f">Продлить ключом<input id="renewIn" autocomplete="off" autocapitalize="characters" placeholder="ZK-XXXX-XXXX"></label>
        <p class="err" id="renewErr"></p><button class="soft" data-act="renew">Продлить</button>` : ''}
      <button class="bg" style="align-self:flex-start;margin-left:-12px" data-act="logout">Выйти из аккаунта</button></div></section>
    ${isTeamOwner() ? teamBlock() : ''}
    <section class="sec"><span class="eyebrow" data-act="secretA" style="cursor:default">Оформление</span>
      <div class="seg" role="group" aria-label="Тема">${th('classic', 'Классика')}${th('dark', 'Тёмная')}${ls.get('princess', false) ? th('princess', 'Принцесса') : ''}</div></section>
    <section class="sec"><span class="eyebrow">Чем строить маршрут</span><div class="card list-card" role="radiogroup" aria-label="Навигатор" style="overflow:hidden">
      ${[['', 'Спрашивать каждый раз'], ...Object.entries(NAVS)].map(([k, t]) => `<button class="lrow" role="radio" aria-checked="${nav === k}" data-act="nav-set" data-n="${k}" style="min-height:56px"><span class="rd ${nav === k ? 'on' : ''}"></span><span class="grow" style="font-size:16px">${t}</span></button>`).join('')}</div></section>
    <section class="sec"><span class="eyebrow">Заказы</span><div class="card list-card" style="overflow:hidden">
      <button class="lrow" data-act="flist"><span class="b"><b>Все заказы списком</b><span>Поиск и выгрузка для Excel</span></span><span class="chev">${ICON.chev}</span></button>
      <button class="lrow" data-act="filter"><span class="b"><b>Фильтр календаря</b><span>Кто проводит, место, программа</span></span><span class="chev">${ICON.chev}</span></button></div></section>
    <section class="sec"><span class="eyebrow">На iPhone как приложение</span><div class="card" style="padding:16px"><p class="small" style="font-size:14px">Откройте эту страницу в Safari → «Поделиться» → «На экран „Домой“». Появится значок «Gigbook».</p>
      <p class="small" style="font-size:14px;margin-top:6px">Для Android есть полное приложение: <a href="https://github.com/stwile8-sys/zakazi-releases/releases/latest">скачать</a>.</p></div></section>
    <div style="margin-top:28px;text-align:center"><button class="bg small" data-act="secretB" style="cursor:default;color:var(--muted)">Gigbook · веб</button></div>
  </div></div>`;
}

function teamBlock() {
  const t = S.team;
  if (!t) return `<section class="sec"><span class="eyebrow">Команда</span><div class="card" style="padding:16px"><p class="small">${canWrite() ? 'Создаю команду…' : 'Подписка закончилась — команда недоступна.'}</p></div></section>`;
  const mem = [...S.members.values()].sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
  const appr = approvedMembers().length; const max = seats();
  const opt = (key, val, label) => `<button class="chip ${t[key] === val ? 'on' : ''}" data-act="team-set" data-k="${key}" data-v="${val}">${label}</button>`;
  return `<section class="sec"><span class="eyebrow">Команда</span><div class="card" style="padding:16px;display:flex;flex-direction:column;gap:12px">
    <p class="small">Код для сотрудников: <b class="mono" style="font-size:18px;color:var(--fg)">${esc(t.code)}</b></p>
    <button class="soft" data-act="team-share">Отправить код сотруднику</button>
    <p class="small">Сотрудников: ${appr} из ${max >= 999 ? '∞' : max}</p>
    <div class="list">${mem.map((m) => `<div class="row"><div class="grow"><b style="font-weight:500">${esc(m.name || m.email)}</b><br><span class="small">${esc(m.email)}${m.approved ? '' : ' · ждёт подтверждения'}</span></div>
      ${m.approved ? '' : `<button class="primary sm" data-act="member-ok" data-id="${esc(m.id)}">Принять</button>`}
      <button class="icon" data-act="member-del" data-id="${esc(m.id)}" aria-label="Убрать сотрудника">${ICON.close}</button></div>`).join('') || '<p class="small">Пока никого. Отправьте код сотруднику — он введёт его при входе.</p>'}</div>
    <hr><h3>Что видят сотрудники</h3>
    <div class="chips">${opt('range', 'today_tomorrow', 'Сегодня и завтра')}${opt('range', 'all', 'Все будущие')}</div>
    <div class="chips">${opt('onlyAssigned', false, 'Все заказы')}${opt('onlyAssigned', true, 'Только назначенные им')}</div>
    <div class="chips">${opt('showMoney', false, 'Без цены и телефона')}${opt('showMoney', true, 'С ценой и телефоном')}</div>
    <p class="small">Кому назначен заказ — выбирается в самом заказе. Сотрудники только смотрят и строят маршрут.</p></div></section>`;
}

function memberScreen() {
  const t = S.memberTeam;
  const today = todayEd(); const to = t?.range === 'all' ? Infinity : today + 1;
  const list = S.memberFeed.filter((o) => o.date >= today && o.date <= to && o.status !== 'CANCELLED').sort((a, b) => (a.startAt || 0) - (b.startAt || 0));
  const groups = new Map(); list.forEach((o) => { if (!groups.has(o.date)) groups.set(o.date, []); groups.get(o.date).push(o); });
  return `<div class="scr"><header class="top big"><h1>${esc(t?.name || 'Заказы компании')}</h1></header><div class="pad">
    <p class="small" style="font-size:14px">${t?.range === 'all' ? 'Все будущие заказы' : 'Заказы на сегодня и завтра'}${t?.onlyAssigned ? ', назначенные вам' : ''}.</p>
    ${[...groups.entries()].map(([d, os]) => `<h2 class="eyebrow" style="margin-top:20px">${esc(dayTitle(d))}</h2><div class="list" style="margin-top:8px">${os.map((o) => `<article class="card" style="padding:16px">
      <div class="row"><span class="mono" style="font-size:15px;font-weight:500">${fmtT(o.startSec)}–${fmtT(o.endSec)}</span></div>
      <div style="font-size:17px;font-weight:500;margin-top:4px">${esc(o.place || o.address || 'Без места')}</div>
      <div class="small">${esc([o.address && o.place ? o.address : '', o.clientName, o.price ? money(o.price) : '', o.assigneeName ? 'проводит ' + o.assigneeName : ''].filter(Boolean).join(' · '))}</div>
      ${o.comment ? `<p class="small" style="margin-top:4px">${esc(o.comment)}</p>` : ''}
      <div class="row" style="margin-top:12px"><button class="primary sm" data-act="mgo" data-id="${esc(o.id)}">${ICON.route}Маршрут</button>
        ${o.phone && telHref(o.phone) ? `<a class="btn soft" href="${telHref(o.phone)}">Позвонить</a>` : ''}</div></article>`).join('')}</div>`).join('') || '<div class="card empty" style="margin-top:16px"><b>Заказов пока нет</b></div>'}
    <hr style="margin:24px 0 12px"><button class="soft full" data-act="leave">Выйти из команды</button><button class="bg full" data-act="logout">Выйти из аккаунта</button></div></div>`;
}

// ---------------- шторки ----------------
function openSheet(s) { S.sheet = s; $('#sheet').innerHTML = sheetHtml(); if (s.form) afterFormOpen(); }
function closeSheet() { S.sheet = null; $('#sheet').innerHTML = ''; }
const wrapSheet = (inner) => `<div class="scrim" data-act="sheet-scrim"><div class="panel" role="dialog" aria-modal="true"><div class="grab"></div>${inner}</div></div>`;
const shead = (title, sub) => `<div class="shead"><h2>${title}</h2><button class="icon" data-act="sheet-close" aria-label="Закрыть" style="margin-right:-10px">${ICON.close}</button></div>${sub ? `<p class="small" style="font-size:14px;margin-top:-6px">${sub}</p>` : ''}`;

function sheetHtml() {
  const s = S.sheet; if (!s) return '';
  if (s.type === 'order') {
    const o = S.orders.get(s.id); if (!o) return '';
    const tel = telHref(o.phone); const cancelled = o.status === 'CANCELLED'; const tr = String(o.comment || '').startsWith('Передан');
    const st = cancelled ? (tr ? 'Передан' : 'Отменён') : o.status === 'DONE' ? 'Выполнен' : isDone(o) ? 'Прошёл' : isNow(o) ? 'Идёт сейчас' : '';
    if (s.confirm) return wrapSheet(`${shead('Отменить заказ?')}
      <p style="font-size:16px;line-height:1.55;margin:0 0 8px">${esc(dateText(o.date))}, ${fmtT(o.startSec)} · ${esc(o.place || o.clientName || 'заказ')}. Заказ останется зачёркнутым в карточке дня, время освободится, в прибыль он не пойдёт. Вернуть можно там же.</p>
      <button class="primary lg dz" data-act="cancel-yes" data-id="${esc(o.id)}">Отменить заказ</button><button class="bg" data-act="cancel-no">Не отменять</button>`);
    return wrapSheet(`<div class="row" style="gap:10px"><span class="eyebrow">${eyebrowDay(o.date)} · ${durText(lenMin(o))}</span>${st ? `<span class="pill">${st}</span>` : ''}
        <span class="grow"></span>${cancelled ? '' : `<button class="bg" data-act="edit" data-id="${esc(o.id)}" style="margin-right:-12px">Изменить</button>`}</div>
      <div class="otime"><b ${cancelled ? 'style="text-decoration:line-through"' : ''}>${fmtT(o.startSec)}</b><span>–${fmtT(o.endSec)}</span></div>
      <div class="oplace" style="margin-top:0">${esc(o.place || 'Заказ')}</div>${o.address ? `<div class="muted">${esc(o.address)}</div>` : ''}
      <section class="card list-card" style="padding:0 16px;margin-top:12px">
        <div class="kv"><div><div class="k">Клиент</div><div class="v">${esc(o.clientName || '—')}</div>${o.phone ? `<div class="small" style="font-size:14px">${esc(o.phone)}</div>` : ''}</div>
          ${tel ? `<a class="btn icon ln" href="${tel}" aria-label="Позвонить клиенту">${ICON.phone}</a>` : ''}</div>
        ${o.program ? `<div class="kv"><div><div class="k">Программа</div><div class="v">${esc(o.program)}</div></div></div>` : ''}
        <div class="kv"><div><div class="k">Проводит</div><div class="v">${esc(o.assigneeName || 'я')}</div></div></div></section>
      <section class="card sums"><div><div class="small">Сумма</div><div class="v" style="font-weight:700">${o.price ? money(o.price) : '—'}</div></div>
        <div><div class="small">Длительность</div><div class="v">${durText(lenMin(o))}</div></div></section>
      ${o.comment ? `<div style="margin-top:8px"><h2 class="eyebrow">Комментарий</h2><p style="margin-top:6px;line-height:1.55">${esc(o.comment)}</p></div>` : ''}
      ${o.status === 'ACTIVE' && isDone(o) ? `<div class="row wrap"><button class="soft" data-act="done-yes" data-id="${esc(o.id)}">Отметить выполненным</button></div>` : ''}
      <div class="bottom">${cancelled ? (tr ? '' : `<button class="primary lg" data-act="restore" data-id="${esc(o.id)}">Вернуть заказ</button>`)
        : `<button class="primary lg" data-act="go" data-id="${esc(o.id)}">${ICON.route}Маршрут</button>
        <div class="row" style="gap:8px"><span class="grow"></span><button class="bg red grow" data-act="cancel-ask" data-id="${esc(o.id)}">Отменить заказ</button></div>`}</div>`);
  }
  if (s.type === 'nav') {
    return wrapSheet(`${shead('Чем строить маршрут?', 'Gigbook откроет навигатор с готовым маршрутом до места заказа.')}
      <div class="card list-card" style="overflow:hidden">${Object.entries(NAVS).map(([k, t]) =>
      `<button class="lrow" data-act="nav-pick" data-n="${k}" style="min-height:56px"><span class="grow" style="font-size:16px;font-weight:500">${t}</span><span class="chev">${ICON.chev}</span></button>`).join('')}</div>
      <p class="small">Выбор запомнится, поменять можно в настройках.</p>`);
  }
  if (s.type === 'filter') return wrapSheet(filterSheet());
  if (s.type === 'flist') return wrapSheet(filterListSheet());
  if (s.type === 'edit') return wrapSheet(editForm(s));
  if (s.type === 'expense') return wrapSheet(`${shead('Новый расход')}
      <label class="f">Сумма, ₽<input id="exAmount" inputmode="numeric" placeholder="1200"></label>
      <p class="err" id="exErr"></p>
      <div><span class="f" style="display:block;font-size:13px;font-weight:500;margin-bottom:6px">На что</span>
        <div class="chips">${CATEGORIES.map((c, i) => `<button class="chip ${i === 0 ? 'on' : ''}" data-act="ex-cat" data-c="${c}">${c}</button>`).join('')}</div></div>
      <label class="f">День<input id="exDate" type="date" value="${isoOf(todayEd())}"></label>
      <label class="f">Заметка <span class="opt">· необязательно</span><input id="exComment" placeholder="Шары и фольга"></label>
      <button class="primary lg" data-act="expense-save">Добавить расход</button>`);
  if (s.type === 'person') return wrapSheet(personForm(s));
  return '';
}

function filterSheet() {
  const f = S.filter; const live = ordersList().filter((o) => o.status !== 'CANCELLED');
  const perfs = [['', 'Я'], ...[...new Set(live.map(performer).filter(Boolean))].map((k) => [k, performerName(k)])];
  const places = topValues(live, (o) => o.place).slice(0, 20); const progs = topValues(live, (o) => o.program).slice(0, 20);
  const found = live.filter(matches); const t = todayEd();
  const chip = (act, k, label, on) => `<button class="chip ${on ? 'on' : ''}" data-act="${act}" data-k="${esc(k)}">${esc(label)}</button>`;
  return `${shead('Фильтр заказов', `Найдено: ${found.length}, впереди — ${found.filter((o) => o.date >= t).length}`)}
    <h2 class="eyebrow" style="margin-top:8px">Кто проводит</h2><div class="chips">${perfs.map(([k, n]) => chip('flt-perf', k, n, f.perf.includes(k))).join('')}</div>
    <h2 class="eyebrow" style="margin-top:8px">Место</h2>${places.length ? `<div class="chips">${places.map((p) => chip('flt-place', fkey(p), p, f.places.includes(fkey(p)))).join('')}</div>` : '<p class="small">Места появятся, когда они будут в заказах</p>'}
    <h2 class="eyebrow" style="margin-top:8px">Программа</h2>${progs.length ? `<div class="chips">${progs.map((p) => chip('flt-prog', fkey(p), p, f.programs.includes(fkey(p)))).join('')}</div>` : '<p class="small">Впишите программу в заказ — и по ней можно будет отбирать</p>'}
    <label class="f">Поиск<input id="fltQ" value="${esc(f.q)}" maxlength="60" placeholder="Имя клиента, телефон, слово из комментария"></label>
    <button class="primary lg" data-act="sheet-close">Показать в календаре</button>
    <div class="row"><button class="soft grow" data-act="flist">Списком</button><button class="soft grow" data-act="flt-csv">Скачать для Excel</button></div>
    ${filterActive() ? '<button class="bg red" data-act="flt-reset">Сбросить фильтр</button>' : ''}`;
}
function filterListSheet() {
  const t = todayEd(); const list = shownOrders().filter((o) => o.status !== 'CANCELLED');
  const ahead = list.filter((o) => o.date >= t).sort((a, b) => interval(a)[0] - interval(b)[0]);
  const past = list.filter((o) => o.date < t).sort((a, b) => interval(b)[0] - interval(a)[0]);
  const item = (o) => orderRow(o, dateText(o.date));
  return `${shead(`${filterActive() ? 'Найдено' : 'Все заказы'}: ${list.length}`, filterActive() ? esc(filterLabel()) : '')}
    <div class="row"><button class="soft grow" data-act="filter">Фильтр</button><button class="soft grow" data-act="flt-csv">Скачать для Excel</button></div>
    ${ahead.length ? `<div class="card list-card" style="overflow:hidden">${ahead.map(item).join('')}</div>` : ''}
    ${past.length ? `<h2 class="eyebrow">Прошедшие</h2><div class="card list-card" style="overflow:hidden">${past.map(item).join('')}</div>` : ''}
    ${list.length ? '' : '<div class="card empty"><b>Ничего не нашлось</b><p>Под фильтр ничего не подошло.</p></div>'}`;
}

function editForm(s) {
  const o = s.o; const t = todayEd();
  const places = [...new Set(ordersList().map((x) => x.place).filter(Boolean))].slice(0, 8);
  const programs = topValues(ordersList(), (x) => x.program).slice(0, 8);
  const mem = isTeamOwner() ? approvedMembers() : [];
  const usedNames = [...new Set(ordersList().filter((x) => !x.assignee && (x.assigneeName || '').trim()).map((x) => x.assigneeName.trim()))].slice(0, 8);
  let len = (o.endSec - o.startSec) / 60; if (len <= 0) len += 1440;
  return `<div class="shead"><button class="bg" data-act="sheet-close" style="margin-left:-12px">Отмена</button></div>
    <h1 style="margin-top:-4px">${o.id ? 'Изменить заказ' : 'Новый заказ'}</h1>
    <fieldset><legend class="eyebrow">Когда</legend>
      <div><span class="f" style="display:block;font-size:13px;font-weight:500;margin-bottom:6px">Дата</span>
        <div class="row" style="gap:8px"><button class="icon ln" data-act="fdate" data-d="-1" aria-label="На день раньше">${ICON.left}</button>
          <input id="oDate" type="date" value="${isoOf(o.date)}" class="grow"><button class="icon ln" data-act="fdate" data-d="1" aria-label="На день позже">${ICON.right}</button></div>
        <div class="chips" style="margin-top:8px"><button class="chip ${o.date === t ? 'on' : ''}" data-act="fday" data-ed="${t}">Сегодня</button><button class="chip ${o.date === t + 1 ? 'on' : ''}" data-act="fday" data-ed="${t + 1}">Завтра</button></div></div>
      <div class="row" style="gap:12px"><label class="f grow">Начало<input id="oStart" type="time" step="900" value="${fmtT(o.startSec)}" class="mono"></label><label class="f grow">Конец<input id="oEnd" type="time" step="900" value="${fmtT(o.endSec)}" class="mono"></label></div>
      <div><span class="f" style="display:block;font-size:13px;font-weight:500;margin-bottom:6px">Длительность</span>
        <div class="seg" id="durSeg">${[[1, '1 ч'], [1.5, '1,5 ч'], [2, '2 ч'], [3, '3 ч']].map(([h, l]) => `<button class="${len === h * 60 ? 'on' : ''}" data-act="dur" data-h="${h}">${l}</button>`).join('')}</div></div>
      <div id="clash"></div>
    </fieldset>
    <fieldset><legend class="eyebrow">Клиент и место</legend>
      <label class="f">Имя клиента<input id="oClient" value="${esc(o.clientName)}" placeholder="Ирина" autocomplete="off"></label>
      <label class="f">Телефон <span class="opt">· необязательно</span><input id="oPhone" type="tel" value="${esc(o.phone)}" placeholder="+7 900 123-45-67"></label>
      <label class="f">Куда ехать<input id="oPlace" value="${esc(o.place)}" placeholder="Например, ТЦ или аквапарк"></label>
      ${places.length ? `<div class="chips" style="margin-top:-8px">${places.map((p) => `<button class="chip" data-act="place" data-p="${esc(p)}">${esc(p)}</button>`).join('')}</div>` : ''}
      <label class="f">Адрес <span class="opt">· необязательно</span><input id="oAddress" value="${esc(o.address)}" placeholder="Улица, дом" autocomplete="off"></label>
      <div id="addrState" class="small" style="margin-top:-10px">${Number.isFinite(o.lat) ? '✓ Адрес найден на карте' : ''}</div>
      <div class="sugg card" id="sugg" style="overflow:hidden"></div>
      <label class="f">Программа <span class="opt">· необязательно</span><input id="oProgram" maxlength="100" value="${esc(o.program || '')}" placeholder="День рождения · Человек-паук"></label>
      ${programs.length ? `<div class="chips" style="margin-top:-8px">${programs.map((p) => `<button class="chip" data-act="program" data-p="${esc(p)}">${esc(p)}</button>`).join('')}</div>` : ''}
    </fieldset>
    <fieldset><legend class="eyebrow">Кто проводит</legend><div class="chips" id="assignChips">
      <button class="chip ${!o.assignee && !o.assigneeName ? 'on' : ''}" data-act="assign" data-id="" data-n="">Я</button>
      ${mem.map((m) => `<button class="chip ${o.assignee === m.id ? 'on' : ''}" data-act="assign" data-id="${esc(m.id)}" data-n="${esc(m.name || m.email)}">${esc(m.name || m.email)}</button>`).join('')}
      ${usedNames.filter((n) => !mem.some((m) => (m.name || m.email) === n)).map((n) => `<button class="chip ${!o.assignee && (o.assigneeName || '').trim() === n ? 'on' : ''}" data-act="assign" data-id="" data-n="${esc(n)}">${esc(n)}</button>`).join('')}
      <button class="chip" data-act="assign-other">+ Другой</button></div>
      <label class="f" id="otherWrap" style="display:none">Имя аниматора<input id="oOther" maxlength="60" placeholder="Например, Катя"></label></fieldset>
    <fieldset><legend class="eyebrow">Оплата и заметки</legend>
      <label class="f">Сумма, ₽<input id="oPrice" inputmode="numeric" value="${o.price || ''}" placeholder="7000"></label>
      <label class="f">Комментарий <span class="opt">· необязательно</span><textarea id="oComment" placeholder="Позвонить за час">${esc(o.comment)}</textarea></label></fieldset>
    <p class="err" id="saveErr"></p>
    <div class="bottom"><button class="primary lg" id="saveBtn" data-act="order-save">${o.id ? 'Сохранить изменения' : 'Сохранить заказ'}</button></div>`;
}

function personForm(s) {
  const p = s.p;
  const cb = p.callbackAt > 0 ? new Date(p.callbackAt - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16) : '';
  return `${shead(p.id ? esc(p.name || 'Человек') : 'Новый человек')}
    <div class="chips" id="pStatus">${Object.entries(PERSON_STATUS).map(([k, t]) => `<button class="chip ${p.status === k ? 'on' : ''}" data-act="p-status" data-s="${k}">${cap(t)}</button>`).join('')}</div>
    <div class="row" style="gap:12px"><label class="f grow">Имя<input id="pName" value="${esc(p.name)}"></label><label class="f grow">Телефон<input id="pPhone" type="tel" value="${esc(p.phone)}"></label></div>
    <label class="f">Повод<input id="pOccasion" value="${esc(p.occasion)}" placeholder="День рождения"></label>
    <div class="row" style="gap:12px"><label class="f grow">Именинник<input id="pChild" value="${esc(p.child)}" placeholder="Соня, 6 лет"></label><label class="f grow">Когда примерно<input id="pApprox" value="${esc(p.approxDate)}" placeholder="конец ноября"></label></div>
    <label class="f">Бюджет, ₽<input id="pBudget" inputmode="numeric" value="${p.budget || ''}"></label>
    <label class="f">Перезвонить<input id="pCallback" type="datetime-local" value="${cb}"></label>
    <label class="f">Комментарий<textarea id="pComment">${esc(p.comment)}</textarea></label>
    ${p.id ? `<div class="row">${telHref(p.phone) ? `<a class="btn soft grow" href="${telHref(p.phone)}">Позвонить</a>` : ''}<button class="soft grow" data-act="person-order">Согласился → заказ</button></div>
      <button class="bg red" data-act="person-del">Убрать из списка</button>` : ''}
    <div class="bottom"><button class="primary lg" data-act="person-save">Сохранить</button></div>`;
}

// Форма заказа: живые проверки без перерисовки всей шторки
function readOrderForm() {
  const s = S.sheet; const o = { ...s.o };
  o.date = edOfIso($('#oDate').value) ?? o.date;
  o.startSec = parseT($('#oStart').value) ?? o.startSec;
  o.endSec = parseT($('#oEnd').value) ?? o.endSec;
  o.place = $('#oPlace').value; o.address = $('#oAddress').value; o.clientName = $('#oClient').value;
  o.price = Number(String($('#oPrice').value).replace(/\D/g, '')) || 0; o.phone = $('#oPhone').value; o.comment = $('#oComment').value;
  o.program = $('#oProgram') ? $('#oProgram').value.trim().slice(0, 100) : (o.program || '');
  if ($('#otherWrap') && $('#otherWrap').style.display !== 'none') { o.assignee = ''; o.assigneeName = $('#oOther').value.trim().slice(0, 60); }
  return o;
}
function checkClash() {
  const s = S.sheet; if (!s || s.type !== 'edit') return;
  const o = readOrderForm(); s.o = o;
  const box = $('#clash'); const btn = $('#saveBtn');
  let len = o.endSec - o.startSec; if (len < 0) len += 86400;
  const clash = conflicts(o);
  document.querySelectorAll('#durSeg button').forEach((b) => b.classList.toggle('on', Number(b.dataset.h) * 3600 === len));
  if (o.endSec === o.startSec) { box.innerHTML = '<p class="err">Конец должен быть позже начала</p>'; btn.disabled = true; return; }
  if (clash.length) {
    const f = nextFree(o); const c = clash[0];
    box.innerHTML = `<div role="alert" class="alert"><span style="color:var(--danger)">${ICON.alert}</span><div class="grow"><b>Время занято</b>
      <div style="margin-top:2px;font-size:14px;line-height:1.5">С ${fmtT(c.startSec)} до ${fmtT(c.endSec)} уже стоит «${esc(c.place || c.clientName || 'заказ')}».${clash.length > 1 ? ` И ещё ${clash.length - 1}.` : ''}
        ${f != null ? ` Ближайшее свободное время — ${fmtT(f)}.` : ` В этот день нет окна на ${durText(Math.round(len / 60))} — выберите другой день.`}</div>
      ${f != null ? `<button class="soft" style="margin-top:10px;background:var(--surface)" data-act="fix-time" data-s="${f}" data-l="${len}">Поставить на ${fmtT(f)}–${fmtT(f + len)}</button>` : ''}</div></div>`;
    btn.disabled = true; btn.textContent = 'Время занято'; return;
  }
  box.innerHTML = len > 8 * 3600 ? `<p class="err">Заказ длится ${Math.floor(len / 3600)} ч — проверьте начало и конец</p>` : '';
  btn.disabled = false; btn.textContent = s.o.id ? 'Сохранить изменения' : 'Сохранить заказ';
}
let addrTimer;
function afterFormOpen() {
  const s = S.sheet;
  if (s.type === 'edit') {
    ['#oDate', '#oStart', '#oEnd', '#oOther'].forEach((q) => $(q).addEventListener('change', checkClash));
    $('#oAddress').addEventListener('input', () => {
      s.o.lat = null; s.o.lon = null; $('#addrState').innerHTML = '';
      clearTimeout(addrTimer);
      const q = $('#oAddress').value.trim();
      if (q.length < 4) { $('#sugg').innerHTML = ''; return; }
      addrTimer = setTimeout(async () => {
        $('#addrState').textContent = 'Ищу адрес…';
        const found = await searchAddress(q);
        if (!S.sheet || S.sheet !== s) return;
        $('#addrState').textContent = '';
        s.found = found;
        $('#sugg').innerHTML = found.map((f, i) => `<button data-act="addr" data-i="${i}">${esc(f.name)}<small>${esc(f.address)}</small></button>`).join('');
      }, 600);
    });
    checkClash();
  }
}

// ---------------- нажатия ----------------
document.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-act]'); if (!el) return;
  const act = el.dataset.act; const id = el.dataset.id;
  if (act === 'sheet-scrim') { if (ev.target === el) closeSheet(); return; }
  switch (act) {
    case 'login': login(); break;
    // фильтр
    case 'filter': openSheet({ type: 'filter' }); break;
    case 'flist': openSheet({ type: 'flist' }); break;
    case 'sheet-close': closeSheet(); render(); break;
    case 'flt-perf': case 'flt-place': case 'flt-prog': {
      const key = act === 'flt-perf' ? 'perf' : act === 'flt-place' ? 'places' : 'programs'; const k = el.dataset.k;
      S.filter[key] = S.filter[key].includes(k) ? S.filter[key].filter((x) => x !== k) : [...S.filter[key], k];
      openSheet(S.sheet); render(); break;
    }
    case 'flt-reset': S.filter = { perf: [], places: [], programs: [], q: '' }; if (S.sheet?.type === 'filter') openSheet(S.sheet); render(); break;
    case 'flt-csv': exportCsv(shownOrders().filter((o) => o.status !== 'CANCELLED')); break;
    case 'logout': stopListeners(); await signOut(auth); break;
    case 'recheck': S.acc = { state: 'checking' }; render(); refreshAccount(); break;
    case 'old-import': {
      el.disabled = true; el.textContent = 'Переношу…';
      try { const n = await importOld(); toast(n ? `Перенесено записей: ${n}` : 'Всё уже перенесено'); }
      catch (e) { toast('Не получилось: ' + (e?.message || e)); el.disabled = false; el.textContent = 'Перенести мои заказы'; }
      render(); break;
    }
    case 'old-skip': ls.set('oldImported_' + S.user.uid, true); render(); break;
    case 'renew': {
      el.disabled = true; el.textContent = 'Проверяю…';
      const err = await redeem($('#renewIn').value);
      if (err) { $('#renewErr').textContent = err; el.disabled = false; el.textContent = 'Продлить'; } else { toast('Подписка продлена'); refreshAccount(); }
      break;
    }
    case 'redeem': {
      el.disabled = true; el.textContent = 'Проверяю…';
      const err = await redeem($('#keyIn').value);
      if (err) { $('#keyErr').textContent = err; el.disabled = false; el.textContent = 'Активировать'; } else { toast('Подписка оформлена'); refreshAccount(); }
      break;
    }
    case 'join': {
      el.disabled = true;
      const err = await joinTeam($('#teamIn').value);
      if (err) { $('#teamErr').textContent = err; el.disabled = false; } else refreshAccount();
      break;
    }
    case 'leave': if (confirm('Выйти из команды?')) leaveTeam(); break;
    case 'tab': if (el.dataset.tab === 'cal' && S.tab === 'cal') S.dayOpen = false; S.tab = el.dataset.tab; ls.set('tab', S.tab); closeSheet(); render(); scrollTo(0, 0); break;
    case 'month': shiftMonth(Number(el.dataset.d)); break;
    case 'pick': case 'open-day': S.sel = Number(el.dataset.ed); S.dayOpen = true; render(); scrollTo(0, 0); break;
    case 'day-shift': shiftDay(Number(el.dataset.d)); break;
    case 'back-month': { const d = ymd(S.sel); S.view = { y: d.y, m: d.m }; S.dayOpen = false; render(); scrollTo(0, 0); break; }
    case 'restore': {
      if (!needWrite()) break; const o = S.orders.get(id); if (!o) break;
      if (conflicts({ ...o, status: 'ACTIVE' }).length) { toast('Не вернуть: это время уже занято другим заказом'); break; }
      await setStatus(id, 'ACTIVE', 'Заказ возвращён'); if (S.sheet?.type === 'order') closeSheet(); break;
    }
    case 'period': S.period = el.dataset.p; render(); break;
    case 'fdate': case 'fday': {
      const cur = edOfIso($('#oDate').value) ?? todayEd(); const d = act === 'fday' ? Number(el.dataset.ed) : cur + Number(el.dataset.d);
      $('#oDate').value = isoOf(d); const t = todayEd();
      document.querySelectorAll('[data-act="fday"]').forEach((c) => c.classList.toggle('on', Number(c.dataset.ed) === d && (d === t || d === t + 1)));
      checkClash(); break;
    }
    case 'cancel-no': S.sheet.confirm = false; $('#sheet').innerHTML = sheetHtml(); break;
    case 'person-book': { if (!needWrite()) break; const p = S.people.get(id); if (!p) break;
      openSheet({ type: 'edit', form: true, personId: p.id, o: { id: '', date: todayEd() + 1, startSec: 12 * 3600, endSec: 13 * 3600, place: '', address: '', clientName: p.name || '', phone: p.phone || '',
        price: p.budget || 0, comment: [p.occasion, p.child, p.comment].filter(Boolean).join(' · '), status: 'ACTIVE', lat: null, lon: null } }); break; }
    case 'person-no': { if (!needWrite()) break; const p = S.people.get(id); if (!p) break;
      await setDoc(doc(userCol('people'), id), { status: 'REFUSED', updatedAt: stamp(p.updatedAt) }, { merge: true }).catch((e) => toast('Не получилось: ' + e.message)); toast('Отмечено: отказались'); break; }
    case 'order': if (ev.target.closest('[data-act="go"]')) break; openSheet({ type: 'order', id }); break;
    case 'go': { ev.stopPropagation(); const o = S.orders.get(id); if (o) go(o); break; }
    case 'mgo': { const o = S.memberFeed.find((x) => x.id === id); if (o) go(o); break; }
    case 'nav-pick': { ls.set('nav', el.dataset.n); const o = S.sheet?.order; closeSheet(); if (o) location.href = routeUrl(el.dataset.n, o); break; }
    case 'nav-set': ls.set('nav', el.dataset.n); render(); break;
    case 'new': {
      if (!needWrite()) break;
      const d = Number(el.dataset.ed) || todayEd();
      let st = el.dataset.st ? Number(el.dataset.st) : d === todayEd() ? Math.min(21, Math.max(9, new Date().getHours() + 1)) * 3600 : 12 * 3600;
      const o = { id: '', date: d, startSec: st, endSec: st + 3600, place: '', address: '', clientName: '', phone: '', price: 0, comment: '', program: '', status: 'ACTIVE', lat: null, lon: null, assignee: '', assigneeName: '' };
      // время само не выбрано — сразу ближайшее свободное, чтобы заказ не открывался с «Время занято»
      if (!el.dataset.st && conflicts(o).length) { const f = nextFree(o); if (f != null) { o.startSec = f; o.endSec = (f + 3600) % 86400; } }
      openSheet({ type: 'edit', form: true, o });
      break;
    }
    case 'edit': { if (!needWrite()) break; const o = S.orders.get(id); if (o) openSheet({ type: 'edit', form: true, o: { ...o } }); break; }
    case 'dur': { const st = parseT($('#oStart').value) ?? 12 * 3600; $('#oEnd').value = fmtT(st + Number(el.dataset.h) * 3600); checkClash(); break; }
    case 'place': $('#oPlace').value = el.dataset.p; break;
    case 'program': $('#oProgram').value = el.dataset.p; break;
    case 'addr': { const f = S.sheet.found?.[Number(el.dataset.i)]; if (!f) break; $('#oAddress').value = [f.name, f.address].filter(Boolean).join(', ');
      S.sheet.o.lat = f.lat; S.sheet.o.lon = f.lon; $('#sugg').innerHTML = ''; $('#addrState').textContent = '✓ Адрес найден на карте'; break; }
    case 'assign': S.sheet.o.assignee = id; S.sheet.o.assigneeName = el.dataset.n || '';
      $('#otherWrap').style.display = 'none';
      document.querySelectorAll('#assignChips .chip').forEach((c) => c.classList.toggle('on', c === el)); checkClash(); break;
    case 'assign-other': S.sheet.o.assignee = ''; S.sheet.o.assigneeName = '';
      $('#otherWrap').style.display = ''; $('#oOther').value = ''; $('#oOther').focus();
      document.querySelectorAll('#assignChips .chip').forEach((c) => c.classList.toggle('on', c === el)); checkClash(); break;
    case 'fix-time': { const st = Number(el.dataset.s); $('#oStart').value = fmtT(st); $('#oEnd').value = fmtT(st + Number(el.dataset.l)); checkClash(); break; }
    case 'order-save': {
      const o = readOrderForm(); o.lat = S.sheet.o.lat; o.lon = S.sheet.o.lon;
      if (!o.clientName.trim()) { $('#saveErr').textContent = 'Напишите имя клиента'; $('#oClient').classList.add('bad'); $('#oClient').focus(); break; }
      el.disabled = true;
      const err = await saveOrder(o, S.sheet.personId);
      if (err) { $('#saveErr').textContent = err; el.disabled = false; checkClash(); } else { closeSheet(); render(); }
      break;
    }
    case 'cancel-ask': S.sheet = { ...S.sheet, confirm: true }; $('#sheet').innerHTML = sheetHtml(); break;
    case 'cancel-yes': await setStatus(id, 'CANCELLED', 'Заказ отменён'); closeSheet(); break;
    case 'done-yes': $('#modal').innerHTML = ''; await setStatus(id, 'DONE', 'Отлично! Заказ отмечен как прошедший'); if (S.sheet?.type === 'order') closeSheet(); break;
    case 'done-no': $('#modal').innerHTML = ''; await setStatus(id, 'CANCELLED', 'Отмечено: заказа не было'); break;
    case 'modal-close': $('#modal').innerHTML = ''; break;
    case 'expense-new': if (needWrite()) openSheet({ type: 'expense', form: true, cat: CATEGORIES[0] }); break;
    case 'ex-cat': S.sheet.cat = el.dataset.c; el.parentElement.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === el)); break;
    case 'expense-save': {
      const amount = Number(String($('#exAmount').value).replace(/\D/g, '')) || 0;
      if (!amount) { $('#exErr').textContent = 'Введите сумму'; break; }
      const now = Date.now();
      await setDoc(doc(userCol('expenses'), newUid()), { date: edOfIso($('#exDate').value) ?? todayEd(), amount, category: S.sheet.cat, comment: $('#exComment').value.trim(),
        createdAt: now, updatedAt: now, deleted: false, deletedAt: null }).then(() => toast('Расход добавлен: ' + money(amount))).catch((e) => toast('Не получилось: ' + e.message));
      closeSheet(); break;
    }
    case 'expense-del': { if (!needWrite() || !confirm('Убрать этот расход?')) break; const e = S.expenses.get(id); if (!e) break;
      await setDoc(doc(userCol('expenses'), id), { deleted: true, deletedAt: Date.now(), updatedAt: stamp(e.updatedAt) }, { merge: true }); break; }
    case 'pfilter': S.peopleFilter = el.dataset.f; render(); break;
    case 'person-new': if (needWrite()) openSheet({ type: 'person', form: true, p: { id: '', name: '', phone: '', occasion: '', child: '', approxDate: '', budget: 0, status: 'THINKING', callbackAt: 0, comment: '' } }); break;
    case 'person': { const p = S.people.get(id); if (p) openSheet({ type: 'person', form: true, p: { ...p } }); break; }
    case 'p-status': S.sheet.p.status = el.dataset.s; el.parentElement.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === el)); break;
    case 'person-save': case 'person-order': {
      if (!needWrite()) break;
      const p = S.sheet.p; const old = p.id ? S.people.get(p.id) : null; const pid = p.id || newUid();
      const cbv = $('#pCallback').value;
      const data = { name: $('#pName').value.trim(), phone: $('#pPhone').value.trim(), occasion: $('#pOccasion').value.trim(), child: $('#pChild').value.trim(),
        approxDate: $('#pApprox').value.trim(), budget: Number(String($('#pBudget').value).replace(/\D/g, '')) || 0, status: p.status || 'THINKING',
        callbackAt: cbv ? new Date(cbv).getTime() : 0, comment: $('#pComment').value.trim(), updatedAt: stamp(old?.updatedAt) };
      if (!old) Object.assign(data, { createdAt: Date.now(), deleted: false, approxMonth: 0, source: '', address: '', lat: null, lon: null });
      await setDoc(doc(userCol('people'), pid), data, { merge: true }).catch((e) => toast('Не получилось: ' + e.message));
      closeSheet();
      if (act === 'person-order') {
        const d = todayEd() + 1;
        openSheet({ type: 'edit', form: true, personId: pid, o: { id: '', date: d, startSec: 12 * 3600, endSec: 13 * 3600, place: '', address: '', clientName: data.name, phone: data.phone,
          price: data.budget, comment: [data.occasion, data.child, data.comment].filter(Boolean).join(' · '), status: 'ACTIVE', lat: null, lon: null } });
      } else toast(old ? 'Сохранено' : 'Добавлено в «Люди»');
      break;
    }
    case 'person-del': { if (!needWrite() || !confirm('Убрать из списка?')) break; const p = S.people.get(S.sheet.p.id); if (!p) break;
      await setDoc(doc(userCol('people'), p.id), { deleted: true, updatedAt: stamp(p.updatedAt) }, { merge: true }); closeSheet(); toast('Убрано из списка'); break; }
    case 'theme': ls.set('theme', el.dataset.t); render(); break;
    case 'secretA': S.tapSeq = (S.tapSeq + 'A').slice(-5); break;
    case 'secretB': S.tapSeq = (S.tapSeq + 'B').slice(-5);
      if (S.tapSeq === 'AABBB') { S.tapSeq = ''; if (ls.get('theme', 'classic') === 'princess') { ls.set('theme', 'classic'); toast('Тема «Классика»'); } else { ls.set('princess', true); ls.set('theme', 'princess'); toast('Тема «Принцесса» открыта'); } render(); }
      break;
    // команда
    case 'team-share': {
      const text = `Код команды «${S.team.name}» в приложении «Gigbook»: ${S.team.code}\nВеб-версия (iPhone): ${location.origin}${location.pathname}`;
      if (navigator.share) navigator.share({ text }).catch(() => {}); else { navigator.clipboard?.writeText(text); toast('Скопировано'); }
      break;
    }
    case 'team-set': {
      if (!needWrite()) break;
      let v = el.dataset.v; if (v === 'true') v = true; else if (v === 'false') v = false;
      await updateDoc(doc(db, 'teams', S.user.uid), { [el.dataset.k]: v, updatedAt: Date.now() }).catch((e) => toast('Не получилось: ' + e.message));
      break;
    }
    case 'member-ok': {
      if (!needWrite()) break;
      try { toast((await approveMember(id)) ? 'Сотрудник принят' : `Все места заняты (${seats()}). Попроси больше мест или убери кого-то.`); }
      catch (e) { toast('Не получилось: ' + e.message); }
      break;
    }
    case 'member-del': if (confirm('Убрать сотрудника из команды?')) await removeMember(id).catch((e) => toast('Не получилось: ' + e.message)); break;
    default: break;
  }
});

function shiftMonth(d) {
  let { y, m } = S.view; m += d; if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
  S.view = { y, m }; S.anim = d > 0 ? 'anim-r' : 'anim-l'; render();
}
function shiftDay(d) { S.sel += d; S.anim = d > 0 ? 'anim-r' : 'anim-l'; render(); }
// Свайп по карточке месяца или дня — соседний месяц/день
let swipeX = null, swipeY = null;
document.addEventListener('touchstart', (ev) => {
  const w = ev.target.closest('#mwrap, #dwrap'); if (!w) { swipeX = null; return; }
  swipeX = ev.touches[0].clientX; swipeY = ev.touches[0].clientY;
}, { passive: true });
document.addEventListener('touchend', (ev) => {
  if (swipeX == null) return;
  const dx = ev.changedTouches[0].clientX - swipeX; const dy = ev.changedTouches[0].clientY - swipeY; swipeX = null;
  if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
  if (ev.target.closest('#mwrap')) shiftMonth(dx < 0 ? 1 : -1); else if (ev.target.closest('#dwrap')) shiftDay(dx < 0 ? 1 : -1);
}, { passive: true });

// Дата сменилась, пока страница была открыта — перерисовать (и обновить ленту сотрудников)
let lastDay = todayEd();
setInterval(() => { if (todayEd() !== lastDay) { lastDay = todayEd(); schedulePublish(); } scheduleRender(); }, 60_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.user && S.acc.state !== 'checking') refreshAccount(); });

// поиск в фильтре: календарь за шторкой обновляется сразу, само окно не перерисовываем (чтобы не пропал курсор)
document.addEventListener('input', (ev) => {
  if (ev.target?.id === 'fltQ') { S.filter.q = ev.target.value.slice(0, 60); render(); }
});
