// Google Drive: chỉ dùng thư mục ẩn riêng của app (quyền drive.appdata — Google xếp loại "không nhạy cảm").
// File trên Drive là bản sao lưu ĐÃ MÃ HOÁ — Google không đọc được nội dung.
//
// Đăng nhập (không có máy chủ):
//  - Mở trong trình duyệt: thư viện Google Identity Services (cửa sổ bật lên). Chỉ tải khi bạn đồng bộ.
//  - App đã cài trên màn hình chính (Android): cửa sổ bật lên mở ra tab Chrome riêng và mất liên lạc với app
//    (đăng nhập xong chỉ thấy màn hình trắng). Khi đó dùng trang chuyển tiếp oauth.html: Google chuyển về đó,
//    trang này đưa quyền truy cập về app qua BroadcastChannel + localStorage (app đọc xong xoá ngay, hết hạn sau 5 phút).
// Quyền truy cập (~1 giờ) chỉ giữ trong bộ nhớ của app.

import { GOOGLE_CLIENT_ID as CLIENT_ID } from '../config/google.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const FILE_NAME = 'coin-manager-sync.json';
const API = 'https://www.googleapis.com';

export const HANDOFF_KEY = 'coin-manager-oauth';
const PENDING_KEY = 'coin-manager-oauth-pending';
const HANDOFF_TTL = 5 * 60_000;
const REDIRECT_URI = new URL('oauth.html', location.href).href;

let gisPromise = null;
let token = null; // { value, expiresAt }

export const isStandalone = () => ['standalone', 'minimal-ui', 'fullscreen'].some(m => matchMedia(`(display-mode: ${m})`).matches)
  || navigator.standalone === true;
export const hasValidToken = () => !!token && token.expiresAt - Date.now() > 60_000;

const readJson = key => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
const drop = key => { try { localStorage.removeItem(key); } catch { /* bỏ qua */ } };

// Dọn quyền truy cập còn sót lại (ví dụ app chưa kịp đọc) — không để nằm lâu trong trình duyệt
{
  const stale = readJson(HANDOFF_KEY);
  if (stale && !(Date.now() - stale.at < HANDOFF_TTL)) drop(HANDOFF_KEY);
}

function acceptGrant(msg) {
  if (msg.error) throw new Error(msg.error === 'access_denied' ? 'Bạn đã không cho phép truy cập Google Drive.' : `Lỗi đăng nhập Google: ${msg.error}`);
  if (!String(msg.scope || '').split(' ').includes(SCOPE)) throw new Error('Bạn chưa cho phép app lưu vào Google Drive.');
  token = { value: msg.access_token, expiresAt: Date.now() + Number(msg.expires_in || 3600) * 1000 };
  return token.value;
}

function takeHandoff(state) {
  const msg = readJson(HANDOFF_KEY);
  if (!msg || msg.state !== state || !(Date.now() - msg.at < HANDOFF_TTL)) return null;
  drop(HANDOFF_KEY);
  return msg;
}

/** App đã cài: mở Google trong tab Chrome, chờ trang oauth.html gửi quyền truy cập về. */
function tokenViaRedirect({ hint, action }) {
  const state = crypto.randomUUID();
  localStorage.setItem(PENDING_KEY, JSON.stringify({ state, action, at: Date.now() }));
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'token', scope: SCOPE,
    state, include_granted_scopes: 'true', ...(hint ? { login_hint: hint } : {}),
  });
  window.open(url.href, '_blank');
  return new Promise((resolve, reject) => {
    let settled = false;
    const ch = new BroadcastChannel(HANDOFF_KEY);
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      ch.close();
      clearInterval(poll);
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
      drop(PENDING_KEY);
      err ? reject(err) : resolve(value);
    };
    const take = msg => {
      if (!msg || msg.state !== state) return;
      drop(HANDOFF_KEY);
      try { finish(null, acceptGrant(msg)); } catch (e) { finish(e); }
    };
    const check = () => take(takeHandoff(state));
    ch.onmessage = e => take(e.data);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    const poll = setInterval(check, 1500);
    const timer = setTimeout(() => finish(new Error('Hết thời gian chờ đăng nhập Google. Bấm đồng bộ lại.')), HANDOFF_TTL);
  });
}

/**
 * Trang oauth.html mở ngay trong cửa sổ app rồi quay về (app tải lại, mất trạng thái):
 * lấy quyền truy cập đang chờ. Trả về { action, error? } hoặc null.
 */
export function resumeAfterRedirect() {
  const pending = readJson(PENDING_KEY);
  if (!pending) return null;
  if (!(Date.now() - pending.at < 2 * HANDOFF_TTL)) { drop(PENDING_KEY); return null; }
  const msg = takeHandoff(pending.state);
  if (!msg) return null;
  drop(PENDING_KEY);
  try {
    acceptGrant(msg);
    return { action: pending.action };
  } catch (e) {
    return { action: pending.action, error: e.message };
  }
}

function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve(window.google.accounts.oauth2);
  gisPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => (window.google?.accounts?.oauth2 ? resolve(window.google.accounts.oauth2) : reject(new Error('Thư viện Google lỗi')));
    s.onerror = () => { gisPromise = null; reject(new Error('Không tải được Google (cần có mạng)')); };
    document.head.append(s);
  });
  return gisPromise;
}

/** Tải sẵn thư viện (để khi bấm thì cửa sổ Google mở ngay, không bị trình duyệt chặn). */
export const preload = () => loadGis().catch(() => {});

const POPUP_ERRORS = {
  popup_failed_to_open: 'Trình duyệt chặn cửa sổ Google. Bấm lại lần nữa nhé.',
  popup_closed: 'Bạn đã đóng cửa sổ Google.',
};

/**
 * Phải gọi ngay trong lúc người dùng vừa bấm (cần thao tác người dùng để mở cửa sổ Google).
 * action ('sync' | 'restore') để app biết làm tiếp gì nếu bị tải lại sau khi đăng nhập.
 */
export async function getToken({ hint, action = 'sync' } = {}) {
  if (hasValidToken()) return token.value;
  if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(CLIENT_ID) || CLIENT_ID.startsWith('PASTE_')) {
    throw new Error('Chưa cấu hình Google: điền Client ID vào config/google.js.');
  }
  if (isStandalone()) return tokenViaRedirect({ hint, action });
  const oauth2 = await loadGis();
  return new Promise((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      hint,
      prompt: '',
      callback: resp => {
        if (resp.error) return reject(new Error(resp.error_description || resp.error));
        if (!oauth2.hasGrantedAllScopes(resp, SCOPE)) return reject(new Error('Bạn chưa cho phép app lưu vào Google Drive.'));
        token = { value: resp.access_token, expiresAt: Date.now() + Number(resp.expires_in || 3600) * 1000 };
        resolve(token.value);
      },
      error_callback: err => reject(new Error(POPUP_ERRORS[err?.type] ?? `Lỗi đăng nhập Google: ${err?.message || err?.type}`)),
    });
    client.requestAccessToken();
  });
}

export function forgetToken({ revoke = false } = {}) {
  if (revoke && token) window.google?.accounts?.oauth2?.revoke(token.value, () => {});
  token = null;
}

async function api(path, { method = 'GET', headers = {}, body } = {}) {
  const res = await fetch(API + path, { method, headers: { Authorization: `Bearer ${token?.value}`, ...headers }, body });
  if (res.status === 401) {
    token = null;
    throw new Error('Phiên Google đã hết hạn, bấm đồng bộ lại.');
  }
  if (res.status === 403) throw new Error('Google Drive từ chối (403) — kiểm tra project đã bật "Google Drive API" chưa.');
  if (!res.ok) throw new Error(`Google Drive báo lỗi ${res.status}.`);
  return res;
}

export async function whoAmI() {
  const res = await api('/drive/v3/about?fields=user(emailAddress)');
  return (await res.json()).user?.emailAddress ?? null;
}

/** File đồng bộ trong thư mục ẩn của app, hoặc null. Không đụng tới file nào khác. */
export async function findSyncFile() {
  const q = encodeURIComponent(`name='${FILE_NAME}'`);
  const res = await api(`/drive/v3/files?spaces=appDataFolder&q=${q}&orderBy=modifiedTime%20desc&fields=files(id,modifiedTime)`);
  return (await res.json()).files?.[0] ?? null;
}

export async function downloadSyncFile(id) {
  return (await api(`/drive/v3/files/${encodeURIComponent(id)}?alt=media`)).json();
}

export async function uploadSyncFile(data, id) {
  const body = JSON.stringify(data);
  if (id) {
    const res = await api(`/upload/drive/v3/files/${encodeURIComponent(id)}?uploadType=media&fields=id,modifiedTime`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body,
    });
    return res.json();
  }
  const boundary = `coin-${crypto.randomUUID()}`;
  const meta = JSON.stringify({ name: FILE_NAME, parents: ['appDataFolder'], mimeType: 'application/json' });
  const multipart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`
    + `--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
  const res = await api('/upload/drive/v3/files?uploadType=multipart&fields=id,modifiedTime', {
    method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipart,
  });
  return res.json();
}
