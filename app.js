// «Заказы» — веб-версия (для iPhone: Safari → «Поделиться» → «На экран Домой»).
// Та же база Firebase, что у Android-приложения: тот же вход Google, ключи, подписка и заказы.
// Форматы записей совпадают с Android (data/Sync.kt): date — номер дня, startSec/endSec — секунды дня,
// startAt/endAt — «локальные секунды» (день*86400 + секунда дня), updatedAt — мс (побеждает более позднее).
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, getDoc, getDocFromServer, setDoc,
  updateDoc, deleteDoc, collection, onSnapshot, query, where, runTransaction, serverTimestamp, Timestamp, writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { firebaseConfig, ADMIN_EMAIL } from './config.js';

const fb = initializeApp(firebaseConfig);
const auth = getAuth(fb);
const db = initializeFirestore(fb, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });

// ---------------- мелочи ----------------
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* приватный режим */ } },
};
const newUid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(16).slice(2) + Date.now().toString(16)).replace(/-/g, '');
const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const part = (n = 4) => Array.from({ length: n }, () => ALPH[Math.floor(Math.random() * ALPH.length)]).join('');
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
  sheet: null,                 // { type, ... }
  askedDone: false,            // «Заказ был?» — один вопрос за заход
  tapSeq: '',
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
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--ground').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg || '#E8EBEE');
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

async function redeem(raw) {
  const u = S.user; const key = String(raw || '').trim().toUpperCase().replace(/\s/g, '');
  if (key.length < 8) return 'Введи ключ целиком';
  const friend = part() + part(2);
  try {
    await runTransaction(db, async (tx) => {
      const kref = doc(db, 'keys', key);
      const k = await tx.get(kref);
      if (!k.exists()) throw new Error('Такого ключа нет');
      if (k.data().used === true) throw new Error('Этот ключ уже использован');
      const now = Date.now();
      tx.update(kref, { used: true, usedBy: u.uid, usedAt: now, usedByEmail: u.email || '', usedByName: u.displayName || '' });
      const user = { key, email: u.email || '', name: u.displayName || '', paidUntil: Timestamp.fromMillis(now + Math.min(24, Math.max(1, k.data().months || 1)) * 31 * DAY_MS), disabled: false, createdAt: now, friendCode: friend };
      if (k.data().team === true) { user.team = true; user.seats = k.data().seats || 0; }
      tx.set(doc(db, 'users', u.uid), user);
      tx.set(doc(db, 'friendCodes', friend), { uid: u.uid, name: u.displayName || '' });
    });
    return null;
  } catch (e) {
    const m = String(e?.message || e);
    return /permission/i.test(m) ? 'Сервер не принял ключ. Проверь дату и время на телефоне и попробуй ещё раз' : m;
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
    snap.docChanges().forEach((ch) => { if (ch.type === 'removed') map.delete(ch.doc.id); else map.set(ch.doc.id, { id: ch.doc.id, ...ch.doc.data() }); });
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
      unsubs.push(onSnapshot(q, (s) => { S.memberFeed = s.docs.map((d) => ({ id: d.id, ...d.data() })); scheduleRender(); },
        () => { S.memberFeed = []; scheduleRender(); }));
      scheduleRender();
    }, () => scheduleRender()));
  }
}

let renderQueued = false;
function scheduleRender() { if (renderQueued) return; renderQueued = true; requestAnimationFrame(() => { renderQueued = false; render(); }); }

const stamp = (prev) => Math.max(Date.now(), (prev || 0) + 1);
const ordersList = () => [...S.orders.values()];

function conflicts(o) {
  if (o.status === 'CANCELLED') return [];
  const iv = interval(o);
  return ordersList().filter((x) => x.id !== o.id && x.status !== 'CANCELLED' && Math.abs(x.date - o.date) <= 1 && overlaps(iv, interval(x)))
    .sort((a, b) => interval(a)[0] - interval(b)[0]);
}

/** Ближайшее свободное начало в тот же день для заказа той же длины. */
function nextFree(o) {
  let len = o.endSec - o.startSec; if (len < 0) len += 86400;
  const dayStart = o.date * 86400; const dayEnd = dayStart + 86400;
  let t = dayStart + o.startSec;
  const busy = ordersList().filter((x) => x.id !== o.id && x.status !== 'CANCELLED' && Math.abs(x.date - o.date) <= 1).map(interval).sort((a, b) => a[0] - b[0]);
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
    assignee: o.assignee || '', assigneeName: o.assigneeName || '',
    createdAt: old?.createdAt || Date.now(), updatedAt: stamp(old?.updatedAt),
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
    <p class="caps">Заказ закончился</p><h2>Заказ был?</h2>
    <p>${esc(dateText(o.date))}, ${fmtT(o.startSec)}–${fmtT(o.endSec)}<br><span class="muted">${esc([o.place, o.clientName].filter(Boolean).join(' · '))}</span></p>
    <div class="row"><button class="primary grow" data-act="done-yes" data-id="${o.id}">Был</button><button class="danger grow" data-act="done-no" data-id="${o.id}">Не было</button></div>
    <button class="link" data-act="modal-close">Спросить в другой раз</button></div></div>`;
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
  listen(collection(db, 'teams', uid, 'members'), S.members);
  unsubs.push(onSnapshot(collection(db, 'teams', uid, 'feed'), (s) => {
    S.feedOwn.clear(); s.docs.forEach((d) => S.feedOwn.set(d.id, d.data())); S.feedLoaded = true; schedulePublish();
  }, (e) => console.warn(e)));
}

const seats = () => S.acc.admin ? 999 : (S.acc.seats || 0);
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
      clientName: o.clientName || '', status: o.status, assignee: o.assignee || '', assigneeName: o.assigneeName || '', forAll: !t.onlyAssigned };
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

// ---------------- значки ----------------
const ICON = {
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.9.7 3.1 2.4 3.5 5.2"/></svg>',
  money: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 3v9l6.4 6.4"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>',
  plus: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  left: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  right: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
};

// ---------------- экраны ----------------
function render() {
  applyTheme();
  const st = S.acc.state;
  const full = st === 'active' || st === 'expired';
  document.body.classList.toggle('noTabs', !full);
  $('#banner').innerHTML = banner();
  $('#tabs').innerHTML = full ? tabs() : '';
  $('#main').innerHTML =
    st === 'checking' ? centerCard('<p class="caps">Заказы</p><h1>Проверяю доступ…</h1>')
    : st === 'signedOut' ? loginScreen()
    : st === 'needKey' ? keyScreen()
    : st === 'pending' ? pendingScreen()
    : st === 'disabled' ? centerCard(`<h1>Доступ отключён</h1><p class="muted">Владелец приложения отключил этот аккаунт. Свяжись с ним, чтобы вернуть доступ.</p>
        <button class="soft full" data-act="recheck">Проверить ещё раз</button><button class="link" data-act="logout">Выйти из аккаунта</button>`)
    : st === 'member' ? memberScreen()
    : S.tab === 'people' ? peopleScreen() : S.tab === 'money' ? moneyScreen() : S.tab === 'more' ? moreScreen() : calendarScreen();
  // шторки с формами не перерисовываем, чтобы не стереть набранное
  if (S.sheet && !S.sheet.form) $('#sheet').innerHTML = sheetHtml();
  if (full) maybeAskDone();
}

const centerCard = (inner) => `<div class="center"><div class="card glass">${inner}</div></div>`;
const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const installHint = () => isIos && !standalone
  ? '<p class="small">Чтобы открывать как приложение: внизу Safari нажми «Поделиться» → «На экран „Домой“».</p>' : '';

function loginScreen() {
  return centerCard(`<p class="caps">Заказы</p><h1>Все праздники — в одном месте</h1>
    <p class="muted">Войди тем же Google-аккаунтом, что и в Android-приложении, — заказы будут общие.</p>
    <button class="primary full" data-act="login">Войти через Google</button>${installHint()}`);
}

function keyScreen() {
  return centerCard(`<p class="caps">Ключ доступа</p><h1>Введи ключ</h1>
    <p class="muted">Ключ выдаёт владелец приложения. Он одноразовый и открывает подписку на месяц.</p>
    ${S.acc.offline ? '<p class="err">Нет связи с сервером — проверь интернет.</p>' : ''}
    <label class="f">Ключ<input id="keyIn" autocomplete="off" autocapitalize="characters" placeholder="ZK-XXXX-XXXX"></label>
    <p class="err" id="keyErr"></p>
    <button class="primary full" data-act="redeem">Активировать</button>
    <hr><h3>Я сотрудник компании</h3>
    <p class="small">Попроси у владельца компании код команды. После заявки он подтвердит тебя у себя.</p>
    <label class="f">Код команды<input id="teamIn" autocomplete="off" autocapitalize="characters" placeholder="XXXXXX"></label>
    <p class="err" id="teamErr"></p>
    <button class="soft full" data-act="join">Отправить заявку</button>
    <p class="small">Вошли как ${esc(S.user?.email)}</p><button class="link" data-act="logout">Выйти из аккаунта</button>`);
}

function pendingScreen() {
  return centerCard(`<p class="caps">Команда</p><h1>Заявка отправлена</h1>
    <p class="muted">Владелец компании должен подтвердить тебя в разделе «Команда». Потом здесь появятся заказы.</p>
    <button class="primary full" data-act="recheck">Проверить</button>
    <button class="soft full" data-act="leave">Отменить заявку</button><button class="link" data-act="logout">Выйти из аккаунта</button>`);
}

function banner() {
  const a = S.acc;
  if (a.state === 'expired') return '<div class="bad">Подписка закончилась — только просмотр. Продли у владельца.</div>';
  if (a.state === 'active' && !a.admin && a.until) {
    const left = Math.floor((a.until - Date.now()) / DAY_MS);
    if (left >= 0 && left <= 4) { const t = ymd(Math.floor(a.until / DAY_MS)); return `<div>Подписка до ${t.d} ${MONTHS_GEN[t.m - 1]} — осталось ${left + 1} дн.</div>`; }
  }
  return '';
}

function tabs() {
  const b = (id, label) => `<button class="${S.tab === id ? 'on' : ''}" data-act="tab" data-tab="${id}">${ICON[id]}${label}</button>`;
  return `<div class="bar glass">${b('cal', 'Календарь')}${b('people', 'Люди')}${b('money', 'Деньги')}${b('more', 'Ещё')}</div>`;
}

function profit(from, to) {
  const now = nowSec();
  const inc = ordersList().filter((o) => o.status !== 'CANCELLED' && (from == null || o.date >= from) && (to == null || o.date <= to) && interval(o)[1] <= now)
    .reduce((s, o) => s + (Number(o.price) || 0), 0);
  const exp = [...S.expenses.values()].filter((e) => !e.deleted && (from == null || e.date >= from) && (to == null || e.date <= to))
    .reduce((s, e) => s + (Number(e.amount) || 0), 0);
  return { income: inc, expenses: exp, balance: inc - exp };
}
const weekStart = () => todayEd() - weekday(todayEd());

function orderCard(o, opts = {}) {
  const [s, e] = interval(o);
  const cancelled = o.status === 'CANCELLED';
  return `<div class="order glass ${cancelled ? 'cancelled' : ''}" data-act="${opts.act || 'order'}" data-id="${o.id}">
    <div class="time">${fmtT(o.startSec)}<small>${fmtT(o.endSec)}</small></div>
    <div class="body"><span class="place">${esc(o.place || o.address || 'Без места')}</span>
      <span class="small">${esc([o.clientName, o.address && o.place ? o.address : ''].filter(Boolean).join(' · '))}</span>
      <span class="row wrap" style="gap:6px">${o.price ? `<span class="tag">${money(o.price)}</span>` : ''}
        ${o.status === 'DONE' ? '<span class="tag ok">✓ был</span>' : ''}${cancelled ? '<span class="tag">отменён</span>' : ''}
        ${o.assigneeName ? `<span class="tag">👤 ${esc(o.assigneeName)}</span>` : ''}${opts.extra || ''}</span>
    </div></div>`;
}

function calendarScreen() {
  const { y, m } = S.view;
  const week = profit(weekStart(), weekStart() + 6);
  const frac = week.income > 0 ? Math.max(0, Math.min(1, week.balance / week.income)) : 0;
  const now = nowSec();
  const nearest = ordersList().filter((o) => o.status === 'ACTIVE' && interval(o)[1] > now).sort((a, b) => interval(a)[0] - interval(b)[0])[0];
  const first = ed(y, m, 1); const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const byDay = new Map();
  for (const o of ordersList()) if (o.status !== 'CANCELLED') byDay.set(o.date, (byDay.get(o.date) || 0) + 1);
  const cells = [];
  for (let i = 0; i < weekday(first); i++) cells.push('<div class="day out"></div>');
  for (let d = 1; d <= days; d++) {
    const e = first + d - 1; const n = Math.min(3, byDay.get(e) || 0);
    cells.push(`<button class="day ${e === todayEd() ? 'today' : ''} ${e === S.sel ? 'sel' : ''}" data-act="pick" data-ed="${e}" aria-label="${dateText(e)}">${d}<span class="dots">${'<i></i>'.repeat(n)}</span></button>`);
  }
  const dayOrders = ordersList().filter((o) => o.date === S.sel).sort((a, b) => a.startSec - b.startSec);
  const busyH = dayOrders.filter((o) => o.status !== 'CANCELLED').reduce((s, o) => { const [a, b] = interval(o); return s + (b - a) / 3600; }, 0);
  const C = 2 * Math.PI * 24;
  return `<div class="stack">
    <div class="head"><div class="t"><span class="caps" data-act="secretA">МОИ ЗАКАЗЫ</span><span class="title" data-act="secretB">${y}</span></div>
      <button class="ring" data-act="tab" data-tab="money" style="background:none;padding:0;min-height:0" aria-label="Прибыль за неделю">
        <svg width="58" height="58" viewBox="0 0 58 58"><circle cx="29" cy="29" r="24" fill="none" stroke="var(--accent-soft)" stroke-width="4"/>
        <circle cx="29" cy="29" r="24" fill="none" stroke="var(--accent)" stroke-width="4" stroke-linecap="round" stroke-dasharray="${C * frac} ${C}"/></svg>
        <b>${short(week.balance)}<small>неделя</small></b></button></div>
    ${nearest ? `<div class="nearest" data-act="order" data-id="${nearest.id}"><span class="caps">Ближайший заказ</span>
      <span class="big">${esc(dayTitle(nearest.date))}, ${fmtT(nearest.startSec)}</span>
      <span>${esc([nearest.place, nearest.address].filter(Boolean).join(' · ') || 'Без места')}</span>
      <span class="row" style="margin-top:6px"><button class="soft" data-act="go" data-id="${nearest.id}" style="background:rgba(255,255,255,.18);color:#fff;border:0">Поехать</button></span></div>` : ''}
    <div class="month glass">
      <div class="mhead"><button class="icon soft" data-act="month" data-d="-1" aria-label="Предыдущий месяц">${ICON.left}</button>
        <h3>${MONTHS[m - 1]} ${y}</h3><button class="icon soft" data-act="month" data-d="1" aria-label="Следующий месяц">${ICON.right}</button></div>
      <div class="grid">${WD.map((w) => `<div class="wd">${w}</div>`).join('')}${cells.join('')}</div>
    </div>
    <div class="row"><div class="grow"><h3>${esc(dayTitle(S.sel))}</h3><span class="small">${dayOrders.filter((o) => o.status !== 'CANCELLED').length ? '' : 'нет заказов · '}свободно ${hoursText(Math.max(0, 14 - busyH))} из 8:00–22:00</span></div>
      <button class="primary" data-act="new" data-ed="${S.sel}">${ICON.plus}Заказ</button></div>
    <div class="list">${dayOrders.map((o) => orderCard(o)).join('') || '<div class="empty">В этот день свободно</div>'}</div>
  </div>`;
}

function peopleScreen() {
  const f = S.peopleFilter || 'ALL';
  const list = [...S.people.values()].filter((p) => !p.deleted && (f === 'ALL' || p.status === f))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const chip = (k, t) => `<button class="chip ${f === k ? 'on' : ''}" data-act="pfilter" data-f="${k}">${t}</button>`;
  return `<div class="stack"><div class="head"><div class="t"><span class="caps">Люди</span><span class="title">Кто звонил</span></div>
      <button class="primary" data-act="person-new">${ICON.plus}Добавить</button></div>
    <div class="chips">${chip('ALL', 'Все')}${Object.entries(PERSON_STATUS).map(([k, t]) => chip(k, t)).join('')}</div>
    <div class="list">${list.map((p) => `<div class="order glass" data-act="person" data-id="${p.id}"><div class="body">
      <span class="place">${esc(p.name || p.phone || 'Без имени')}</span>
      <span class="small">${esc([p.occasion, p.child, p.approxDate].filter(Boolean).join(' · '))}</span>
      <span class="row wrap" style="gap:6px"><span class="tag">${PERSON_STATUS[p.status] || 'думает'}</span>${p.budget ? `<span class="tag">${money(p.budget)}</span>` : ''}
      ${p.callbackAt > Date.now() ? `<span class="tag">перезвонить ${new Date(p.callbackAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>` : ''}</span>
    </div></div>`).join('') || '<div class="empty">Сюда попадают те, кто звонил и думает, согласился или отказался.</div>'}</div></div>`;
}

function moneyScreen() {
  const t = todayEd(); const { y, m } = ymd(t);
  const mFrom = ed(y, m, 1); const mTo = ed(y, m + 1, 1) - 1;
  const stat = (title, p) => `<div class="stat glass"><span class="caps">${title}</span><span class="big">${money(p.balance)}</span>
    <div class="row small"><span>Доход ${money(p.income)}</span><span>Расходы ${money(p.expenses)}</span></div></div>`;
  const ex = [...S.expenses.values()].filter((e) => !e.deleted && e.date >= mFrom && e.date <= mTo).sort((a, b) => b.date - a.date);
  return `<div class="stack"><div class="head"><div class="t"><span class="caps">Деньги</span><span class="title">Прибыль</span></div>
      <button class="primary" data-act="expense-new">${ICON.plus}Расход</button></div>
    ${stat('Эта неделя', profit(weekStart(), weekStart() + 6))}${stat(MONTHS[m - 1], profit(mFrom, mTo))}${stat('За всё время', profit(null, null))}
    <h3>Расходы за ${MONTHS[m - 1].toLowerCase()}</h3>
    <div class="list">${ex.map((e) => `<div class="order glass"><div class="time">${ymd(e.date).d}<small>${MONTHS_GEN[ymd(e.date).m - 1].slice(0, 3)}</small></div>
      <div class="body"><span class="place">${money(e.amount)}</span><span class="small">${esc([e.category, e.comment].filter(Boolean).join(' · '))}</span></div>
      <button class="icon soft" data-act="expense-del" data-id="${e.id}" aria-label="Удалить расход">✕</button></div>`).join('') || '<div class="empty">Расходов в этом месяце нет</div>'}</div></div>`;
}

function moreScreen() {
  const a = S.acc; const theme = ls.get('theme', 'classic'); const nav = ls.get('nav', '');
  const th = (k, t) => `<button class="chip ${theme === k ? 'on' : ''}" data-act="theme" data-t="${k}">${t}</button>`;
  const until = a.admin ? 'без срока (владелец)' : a.until ? (() => { const t = ymd(Math.floor(a.until / DAY_MS)); return `до ${t.d} ${MONTHS_GEN[t.m - 1]} ${t.y}`; })() : '—';
  return `<div class="stack"><div class="head"><div class="t"><span class="caps">Ещё</span><span class="title">Настройки</span></div></div>
    <div class="card glass"><h3>Аккаунт</h3><p>${esc(S.user?.displayName || '')}<br><span class="small">${esc(S.user?.email || '')}</span></p>
      <p class="small">Подписка: ${until}${a.team ? ` · командная, мест: ${seats() >= 999 ? 'без ограничений' : seats()}` : ''}</p>
      ${a.friend ? `<p class="small">Код для коллег: <b>${esc(a.friend)}</b></p>` : ''}
      <button class="soft full" data-act="logout">Выйти из аккаунта</button></div>
    ${isTeamOwner() ? teamBlock() : ''}
    <div class="card glass"><h3>Оформление</h3><div class="chips">${th('classic', 'Классика')}${th('dark', 'Тёмное')}${ls.get('princess', false) ? th('princess', 'Принцесса') : ''}</div></div>
    <div class="card glass"><h3>Навигатор для «Поехать»</h3><div class="chips">
      <button class="chip ${!nav ? 'on' : ''}" data-act="nav-set" data-n="">Спрашивать</button>
      ${Object.entries(NAVS).map(([k, t]) => `<button class="chip ${nav === k ? 'on' : ''}" data-act="nav-set" data-n="${k}">${t}</button>`).join('')}</div></div>
    <div class="card glass"><h3>На iPhone как приложение</h3><p class="small">Открой эту страницу в Safari → «Поделиться» → «На экран „Домой“». Появится значок «Заказы».</p>
      <p class="small">Для Android есть полное приложение: <a href="https://github.com/stwile8-sys/zakazi-releases/releases/latest">скачать</a>.</p></div>
  </div>`;
}

function teamBlock() {
  const t = S.team;
  if (!t) return `<div class="card glass"><h3>Команда</h3><p class="small">${canWrite() ? 'Создаю команду…' : 'Подписка закончилась — команда недоступна.'}</p></div>`;
  const mem = [...S.members.values()].sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
  const appr = approvedMembers().length; const max = seats();
  const opt = (key, val, label) => `<button class="chip ${t[key] === val ? 'on' : ''}" data-act="team-set" data-k="${key}" data-v="${val}">${label}</button>`;
  return `<div class="card glass"><h3>Команда</h3>
    <p class="small">Код для сотрудников: <b style="font-size:18px;color:var(--ink)">${esc(t.code)}</b></p>
    <button class="soft full" data-act="team-share">Отправить код сотруднику</button>
    <p class="small">Сотрудников: ${appr} из ${max >= 999 ? '∞' : max}</p>
    <div class="list">${mem.map((m) => `<div class="row"><div class="grow"><b>${esc(m.name || m.email)}</b><br><span class="small">${esc(m.email)}${m.approved ? '' : ' · ждёт подтверждения'}</span></div>
      ${m.approved ? '' : `<button class="primary" data-act="member-ok" data-id="${m.id}">Принять</button>`}
      <button class="icon soft" data-act="member-del" data-id="${m.id}" aria-label="Убрать сотрудника">✕</button></div>`).join('') || '<p class="small">Пока никого. Отправь код сотруднику — он введёт его при входе.</p>'}</div>
    <hr><h3>Что видят сотрудники</h3>
    <div class="chips">${opt('range', 'today_tomorrow', 'Сегодня и завтра')}${opt('range', 'all', 'Все будущие')}</div>
    <div class="chips">${opt('onlyAssigned', false, 'Все заказы')}${opt('onlyAssigned', true, 'Только назначенные им')}</div>
    <div class="chips">${opt('showMoney', false, 'Без цены и телефона')}${opt('showMoney', true, 'С ценой и телефоном')}</div>
    <p class="small">Кому назначен заказ — выбирается в самом заказе. Сотрудники только смотрят и строят маршрут.</p></div>`;
}

function memberScreen() {
  const t = S.memberTeam;
  const today = todayEd(); const to = t?.range === 'all' ? Infinity : today + 1;
  const list = S.memberFeed.filter((o) => o.date >= today && o.date <= to && o.status !== 'CANCELLED').sort((a, b) => (a.startAt || 0) - (b.startAt || 0));
  const groups = new Map(); list.forEach((o) => { if (!groups.has(o.date)) groups.set(o.date, []); groups.get(o.date).push(o); });
  return `<div class="stack"><div class="head"><div class="t"><span class="caps">Команда</span><span class="title">${esc(t?.name || 'Заказы компании')}</span></div></div>
    <p class="small">${t?.range === 'all' ? 'Все будущие заказы' : 'Заказы на сегодня и завтра'}${t?.onlyAssigned ? ', назначенные тебе' : ''}.</p>
    ${[...groups.entries()].map(([d, os]) => `<h3>${esc(dayTitle(d))}</h3><div class="list">${os.map((o) => `<div class="order glass">
      <div class="time">${fmtT(o.startSec)}<small>${fmtT(o.endSec)}</small></div>
      <div class="body"><span class="place">${esc(o.place || o.address || 'Без места')}</span>
        <span class="small">${esc([o.address && o.place ? o.address : '', o.clientName].filter(Boolean).join(' · '))}</span>
        ${o.comment ? `<span class="small">${esc(o.comment)}</span>` : ''}
        <span class="row wrap" style="gap:6px">${o.price ? `<span class="tag">${money(o.price)}</span>` : ''}${o.assigneeName ? `<span class="tag">👤 ${esc(o.assigneeName)}</span>` : ''}</span>
        <span class="row wrap" style="margin-top:6px"><button class="primary" data-act="mgo" data-id="${o.id}">Маршрут</button>
          ${o.phone && telHref(o.phone) ? `<a class="btn soft" href="${telHref(o.phone)}">Позвонить</a>` : ''}</span>
      </div></div>`).join('')}</div>`).join('') || '<div class="empty">Заказов пока нет</div>'}
    <hr><button class="soft full" data-act="leave">Выйти из команды</button><button class="link" data-act="logout">Выйти из аккаунта</button></div>`;
}

// ---------------- шторки ----------------
function openSheet(s) { S.sheet = s; $('#sheet').innerHTML = sheetHtml(); if (s.form) afterFormOpen(); }
function closeSheet() { S.sheet = null; $('#sheet').innerHTML = ''; }
const wrapSheet = (inner) => `<div class="scrim" data-act="sheet-scrim"><div class="panel" role="dialog" aria-modal="true"><div class="grab"></div>${inner}</div></div>`;

function sheetHtml() {
  const s = S.sheet; if (!s) return '';
  if (s.type === 'order') {
    const o = S.orders.get(s.id); if (!o) return '';
    const tel = telHref(o.phone);
    return wrapSheet(`<p class="caps">${o.status === 'CANCELLED' ? 'Отменён' : o.status === 'DONE' ? 'Выполнен' : 'Заказ'}</p>
      <h2>${esc(dayTitle(o.date))}</h2><h3>${fmtT(o.startSec)}–${fmtT(o.endSec)} · ${esc(o.place || 'Без места')}</h3>
      ${o.address ? `<p>${esc(o.address)}</p>` : ''}
      <p>${esc(o.clientName)}${o.phone ? ` · ${esc(o.phone)}` : ''}</p>
      ${o.price ? `<p><b>${money(o.price)}</b></p>` : ''}${o.comment ? `<p class="muted">${esc(o.comment)}</p>` : ''}
      ${o.assigneeName ? `<p class="small">Сотрудник: ${esc(o.assigneeName)}</p>` : ''}
      <div class="row"><button class="primary grow" data-act="go" data-id="${o.id}">Поехать</button>${tel ? `<a class="btn soft grow" href="${tel}">Позвонить</a>` : ''}</div>
      ${o.status !== 'CANCELLED' ? `<div class="row"><button class="soft grow" data-act="edit" data-id="${o.id}">Изменить</button>
        ${o.status === 'ACTIVE' ? `<button class="soft grow" data-act="done-yes" data-id="${o.id}">Выполнен</button>` : ''}</div>
        <button class="danger full" data-act="cancel-ask" data-id="${o.id}">Отменить заказ</button>` : ''}`);
  }
  if (s.type === 'nav') {
    return wrapSheet(`<h2>Чем построить маршрут?</h2><div class="list">${Object.entries(NAVS).map(([k, t]) =>
      `<button class="soft full" data-act="nav-pick" data-n="${k}">${t}</button>`).join('')}</div>
      <p class="small">Выбор запомнится, поменять можно в «Ещё».</p>`);
  }
  if (s.type === 'edit') return wrapSheet(editForm(s));
  if (s.type === 'expense') return wrapSheet(`<h2>Новый расход</h2>
      <label class="f">Сумма, ₽<input id="exAmount" inputmode="numeric" placeholder="0"></label>
      <label class="f">Дата<input id="exDate" type="date" value="${isoOf(todayEd())}"></label>
      <div class="chips">${CATEGORIES.map((c, i) => `<button class="chip ${i === 0 ? 'on' : ''}" data-act="ex-cat" data-c="${c}">${c}</button>`).join('')}</div>
      <label class="f">Комментарий<input id="exComment"></label>
      <button class="primary full" data-act="expense-save">Добавить</button>`);
  if (s.type === 'person') return wrapSheet(personForm(s));
  return '';
}

function editForm(s) {
  const o = s.o;
  const places = [...new Set(ordersList().map((x) => x.place).filter(Boolean))].slice(0, 8);
  const mem = isTeamOwner() ? approvedMembers() : [];
  return `<h2>${o.id ? 'Изменить заказ' : 'Новый заказ'}</h2>
    <label class="f">Дата<input id="oDate" type="date" value="${isoOf(o.date)}"></label>
    <div class="row"><label class="f grow">С<input id="oStart" type="time" value="${fmtT(o.startSec)}"></label><label class="f grow">До<input id="oEnd" type="time" value="${fmtT(o.endSec)}"></label></div>
    <div class="chips">${[[1, '1 ч'], [1.5, '1,5 ч'], [2, '2 ч'], [3, '3 ч']].map(([h, t]) => `<button class="chip" data-act="dur" data-h="${h}">${t}</button>`).join('')}</div>
    <div id="clash"></div>
    <label class="f">Место<input id="oPlace" value="${esc(o.place)}" placeholder="Например, ТЦ или аквапарк"></label>
    ${places.length ? `<div class="chips">${places.map((p) => `<button class="chip" data-act="place" data-p="${esc(p)}">${esc(p)}</button>`).join('')}</div>` : ''}
    <label class="f">Адрес<input id="oAddress" value="${esc(o.address)}" placeholder="Улица, дом" autocomplete="off"></label>
    <div id="addrState" class="small">${Number.isFinite(o.lat) ? '<span class="okc">Адрес найден на карте ✓</span>' : ''}</div>
    <div class="sugg" id="sugg"></div>
    <div class="row"><label class="f grow">Имя клиента<input id="oClient" value="${esc(o.clientName)}"></label>
      <label class="f grow">Цена, ₽<input id="oPrice" inputmode="numeric" value="${o.price || ''}" placeholder="0"></label></div>
    <label class="f">Телефон<input id="oPhone" type="tel" value="${esc(o.phone)}" placeholder="+7"></label>
    <label class="f">Комментарий<textarea id="oComment" placeholder="Что важно не забыть">${esc(o.comment)}</textarea></label>
    ${mem.length ? `<h3>Кто проводит</h3><div class="chips" id="assignChips"><button class="chip ${!o.assignee ? 'on' : ''}" data-act="assign" data-id="">Не назначен</button>
      ${mem.map((m) => `<button class="chip ${o.assignee === m.id ? 'on' : ''}" data-act="assign" data-id="${m.id}" data-n="${esc(m.name || m.email)}">${esc(m.name || m.email)}</button>`).join('')}</div>` : ''}
    <p class="err" id="saveErr"></p>
    <button class="primary full" id="saveBtn" data-act="order-save">Сохранить заказ</button>`;
}

function personForm(s) {
  const p = s.p;
  const cb = p.callbackAt > 0 ? new Date(p.callbackAt - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16) : '';
  return `<h2>${p.id ? esc(p.name || 'Человек') : 'Новый человек'}</h2>
    <div class="row"><label class="f grow">Имя<input id="pName" value="${esc(p.name)}"></label><label class="f grow">Телефон<input id="pPhone" type="tel" value="${esc(p.phone)}"></label></div>
    <label class="f">Повод<input id="pOccasion" value="${esc(p.occasion)}" placeholder="День рождения"></label>
    <div class="row"><label class="f grow">Именинник<input id="pChild" value="${esc(p.child)}" placeholder="Соня, 6 лет"></label><label class="f grow">Когда примерно<input id="pApprox" value="${esc(p.approxDate)}" placeholder="конец ноября"></label></div>
    <label class="f">Бюджет, ₽<input id="pBudget" inputmode="numeric" value="${p.budget || ''}"></label>
    <div class="chips" id="pStatus">${Object.entries(PERSON_STATUS).map(([k, t]) => `<button class="chip ${p.status === k ? 'on' : ''}" data-act="p-status" data-s="${k}">${t}</button>`).join('')}</div>
    <label class="f">Перезвонить<input id="pCallback" type="datetime-local" value="${cb}"></label>
    <label class="f">Комментарий<textarea id="pComment">${esc(p.comment)}</textarea></label>
    <button class="primary full" data-act="person-save">Сохранить</button>
    ${p.id ? `<div class="row">${telHref(p.phone) ? `<a class="btn soft grow" href="${telHref(p.phone)}">Позвонить</a>` : ''}<button class="soft grow" data-act="person-order">Согласился → заказ</button></div>
      <button class="danger full" data-act="person-del">Убрать из списка</button>` : ''}`;
}

// Форма заказа: живые проверки без перерисовки всей шторки
function readOrderForm() {
  const s = S.sheet; const o = { ...s.o };
  o.date = edOfIso($('#oDate').value) ?? o.date;
  o.startSec = parseT($('#oStart').value) ?? o.startSec;
  o.endSec = parseT($('#oEnd').value) ?? o.endSec;
  o.place = $('#oPlace').value; o.address = $('#oAddress').value; o.clientName = $('#oClient').value;
  o.price = Number(String($('#oPrice').value).replace(/\D/g, '')) || 0; o.phone = $('#oPhone').value; o.comment = $('#oComment').value;
  return o;
}
function checkClash() {
  const s = S.sheet; if (!s || s.type !== 'edit') return;
  const o = readOrderForm(); s.o = o;
  const box = $('#clash'); const btn = $('#saveBtn');
  let len = o.endSec - o.startSec; if (len < 0) len += 86400;
  const clash = conflicts(o);
  if (o.endSec === o.startSec) { box.innerHTML = '<p class="err">Конец должен быть позже начала</p>'; btn.disabled = true; return; }
  if (clash.length) {
    const f = nextFree(o);
    box.innerHTML = `<div class="card" style="background:var(--error-soft);padding:12px"><p class="err">Время занято: ${clash.map((c) => `${fmtT(c.startSec)}–${fmtT(c.endSec)} ${esc(c.place)}`).join(', ')}</p>
      ${f != null ? `<button class="danger" data-act="fix-time" data-s="${f}" data-l="${len}">Поставить на ${fmtT(f)}–${fmtT(f + len)}</button>` : ''}</div>`;
    btn.disabled = true; btn.textContent = 'Время занято'; return;
  }
  box.innerHTML = len > 8 * 3600 ? `<p class="err">Заказ длится ${Math.floor(len / 3600)} ч — проверь время «С» и «До»</p>` : '';
  btn.disabled = false; btn.textContent = 'Сохранить заказ';
}
let addrTimer;
function afterFormOpen() {
  const s = S.sheet;
  if (s.type === 'edit') {
    ['#oDate', '#oStart', '#oEnd'].forEach((q) => $(q).addEventListener('change', checkClash));
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
        $('#sugg').innerHTML = found.map((f, i) => `<button class="soft" data-act="addr" data-i="${i}">${esc(f.name)}<small>${esc(f.address)}</small></button>`).join('');
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
    case 'logout': stopListeners(); await signOut(auth); break;
    case 'recheck': S.acc = { state: 'checking' }; render(); refreshAccount(); break;
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
    case 'tab': S.tab = el.dataset.tab; ls.set('tab', S.tab); closeSheet(); render(); scrollTo(0, 0); break;
    case 'month': { let { y, m } = S.view; m += Number(el.dataset.d); if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; } S.view = { y, m }; render(); break; }
    case 'pick': S.sel = Number(el.dataset.ed); render(); break;
    case 'order': if (ev.target.closest('[data-act="go"]')) break; openSheet({ type: 'order', id }); break;
    case 'go': { ev.stopPropagation(); const o = S.orders.get(id); if (o) go(o); break; }
    case 'mgo': { const o = S.memberFeed.find((x) => x.id === id); if (o) go(o); break; }
    case 'nav-pick': { ls.set('nav', el.dataset.n); const o = S.sheet?.order; closeSheet(); if (o) location.href = routeUrl(el.dataset.n, o); break; }
    case 'nav-set': ls.set('nav', el.dataset.n); render(); break;
    case 'new': {
      if (!needWrite()) break;
      const d = Number(el.dataset.ed) || todayEd();
      const st = d === todayEd() ? Math.min(21, Math.max(9, new Date().getHours() + 1)) * 3600 : 12 * 3600;
      openSheet({ type: 'edit', form: true, o: { id: '', date: d, startSec: st, endSec: st + 3600, place: '', address: '', clientName: '', phone: '', price: 0, comment: '', status: 'ACTIVE', lat: null, lon: null } });
      break;
    }
    case 'edit': { if (!needWrite()) break; const o = S.orders.get(id); if (o) openSheet({ type: 'edit', form: true, o: { ...o } }); break; }
    case 'dur': { const st = parseT($('#oStart').value) ?? 12 * 3600; $('#oEnd').value = fmtT(st + Number(el.dataset.h) * 3600); checkClash(); break; }
    case 'place': $('#oPlace').value = el.dataset.p; break;
    case 'addr': { const f = S.sheet.found?.[Number(el.dataset.i)]; if (!f) break; $('#oAddress').value = [f.name, f.address].filter(Boolean).join(', ');
      S.sheet.o.lat = f.lat; S.sheet.o.lon = f.lon; $('#sugg').innerHTML = ''; $('#addrState').innerHTML = '<span class="okc">Адрес найден на карте ✓</span>'; break; }
    case 'assign': S.sheet.o.assignee = id; S.sheet.o.assigneeName = id ? el.dataset.n : '';
      document.querySelectorAll('#assignChips .chip').forEach((c) => c.classList.toggle('on', c === el)); break;
    case 'fix-time': { const st = Number(el.dataset.s); $('#oStart').value = fmtT(st); $('#oEnd').value = fmtT(st + Number(el.dataset.l)); checkClash(); break; }
    case 'order-save': {
      const o = readOrderForm(); o.lat = S.sheet.o.lat; o.lon = S.sheet.o.lon; o.assignee = S.sheet.o.assignee; o.assigneeName = S.sheet.o.assigneeName;
      if (!o.clientName.trim()) { $('#saveErr').textContent = 'Напиши имя клиента'; break; }
      el.disabled = true;
      const err = await saveOrder(o, S.sheet.personId);
      if (err) { $('#saveErr').textContent = err; el.disabled = false; checkClash(); } else { closeSheet(); render(); }
      break;
    }
    case 'cancel-ask': if (confirm('Отменить заказ? Он останется в списке как отменённый.')) { await setStatus(id, 'CANCELLED', 'Заказ отменён'); closeSheet(); } break;
    case 'done-yes': $('#modal').innerHTML = ''; await setStatus(id, 'DONE', 'Отлично! Заказ отмечен как прошедший'); if (S.sheet?.type === 'order') closeSheet(); break;
    case 'done-no': $('#modal').innerHTML = ''; await setStatus(id, 'CANCELLED', 'Отмечено: заказа не было'); break;
    case 'modal-close': $('#modal').innerHTML = ''; break;
    case 'expense-new': if (needWrite()) openSheet({ type: 'expense', form: true, cat: CATEGORIES[0] }); break;
    case 'ex-cat': S.sheet.cat = el.dataset.c; el.parentElement.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === el)); break;
    case 'expense-save': {
      const amount = Number(String($('#exAmount').value).replace(/\D/g, '')) || 0;
      if (!amount) { toast('Введи сумму'); break; }
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
      const text = `Код команды «${S.team.name}» в приложении «Заказы»: ${S.team.code}\nВеб-версия (iPhone): ${location.origin}${location.pathname}`;
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
      if (approvedMembers().length >= seats()) { toast(`Все места заняты (${seats()}). Чтобы добавить, попроси больше мест или убери кого-то.`); break; }
      await updateDoc(doc(db, 'teams', S.user.uid, 'members', id), { approved: true }).then(() => toast('Сотрудник принят')).catch((e) => toast('Не получилось: ' + e.message));
      break;
    }
    case 'member-del': if (confirm('Убрать сотрудника из команды?')) await deleteDoc(doc(db, 'teams', S.user.uid, 'members', id)).catch((e) => toast('Не получилось: ' + e.message)); break;
    default: break;
  }
});

// Дата сменилась, пока страница была открыта — перерисовать (и обновить ленту сотрудников)
let lastDay = todayEd();
setInterval(() => { if (todayEd() !== lastDay) { lastDay = todayEd(); schedulePublish(); } scheduleRender(); }, 60_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.user && S.acc.state !== 'checking') refreshAccount(); });
