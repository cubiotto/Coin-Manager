import { parseUtterance, parseAmountInput } from './parser.js';
import { buildCategories, classify, normalize, FALLBACK } from './categories.js';
import { db } from './db.js';
import { store } from './store.js';
import { passphraseIssues, WrongPassphrase } from './vault.js';
import { createRecognizer, VOICE_ERRORS } from './voice.js';
import { renderDailyColumns, renderDonut } from './charts.js';
import { mergeRows, mergeProfile, isTomb } from './sync.js';
import * as gdrive from './gdrive.js';
import { enhanceDateInputs } from './datepicker.js';
import { openLayer, watchDialogs } from './sheets.js';
import { enableMouseScroll } from './strips.js';
import {
  detectRefund, detectOwe, extractOwes, matchTargets, recentExpenses, knownPeople, netAmount, netParts, refundedOf, owedOn,
  debtsByPerson, planRepayment, personKey, displayPerson,
} from './refunds.js';
import { extractDiscounts, prepPercent, parseDiscountInput, originalOf, savings } from './discounts.js';
import {
  WALLET_ICONS, WALLET_SUGGEST, JARS, liveWallets, isSaving, parseShare, shareText, walletForCategory, planSplit,
  walletBalances, unallocated, upsertWallet, nextTint, nextOrder, monthStart,
} from './wallets.js';
import {
  ASSET_KINDS, ASSET_ICONS, ASSET_SUGGEST, liveAssets, liveMoves, defaultAsset, upsertAsset, parseAliases, assignAssets, assetBalances,
  nextAssetTint, nextAssetOrder,
} from './assets.js';
import { dueRecurring, nextDue, startYmFor, activeRules, nextYm, ymOf } from './recurring.js';
import {
  fmtVND, fmtNum, fmtCompact, today, addDays, monthOf, shiftMonth, daysInMonth, monthLabel, dayLabel, escapeHtml, capitalize,
} from './format.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const sum = list => list.reduce((s, t) => s + t.amount, 0);
// Tổng chi thực: khoản được bạn bè trả lại chỉ tính phần mình thật sự tiêu (xem js/refunds.js)
const spentOf = list => list.reduce((s, t) => s + (t.type === 'expense' ? netAmount(t) : 0), 0);
const esc = escapeHtml;

const DEFAULT_SETTINGS = { slang: true, autoSave: false, lockAfter: 5, autoSync: true, googleConnected: false };
const emptyCustom = () => ({ extraKeywords: {}, added: [] });

const state = {
  // Dữ liệu nhạy cảm — chỉ có khi đã mở khoá, bị xoá khỏi bộ nhớ khi khoá
  txs: [],
  tombs: [],              // dấu xoá { id, deleted, updatedAt } — để đồng bộ việc xoá giữa các máy
  custom: emptyCustom(),
  customUpdatedAt: null,
  learned: {},
  meta: {},
  recurring: [],          // khoản cố định hằng tháng (trong hồ sơ đã mã hoá)
  wallets: [],            // ví nhỏ: ăn uống, tiết kiệm… (trong hồ sơ đã mã hoá)
  allocs: [],             // các lần chia tiền / chuyển tiền vào ví
  assets: [],             // tài sản: tiền mặt, ngân hàng, ví điện tử… (trong hồ sơ đã mã hoá)
  assetMoves: [],         // các lần chuyển giữa tài sản / điều chỉnh số dư
  categories: buildCategories(),
  // Không nhạy cảm
  settings: { ...DEFAULT_SETTINGS },
  month: monthOf(today()),
  view: 'record',
  preview: null,
  histQ: '',
  histCat: '',
  histAsset: '',
  dailyAll: false,
  catTab: 'donut',        // panel danh mục: 'donut' (Tỉ lệ) | 'list' (Danh mục)
  selecting: false,       // đang chọn khoản để gộp
  selected: new Set(),
};

// Khoản cố định (tiền nhà, hóa đơn) làm biểu đồ theo ngày khó đọc nên mặc định tách ra
const FIXED_CATEGORIES = new Set(['nha-o', 'hoa-don']);

const catById = id => state.categories.find(c => c.id === id) ?? state.categories.find(c => c.id === 'khac');

/** onlyType: chỉ liệt kê danh mục cùng loại (dùng cho các món trong một hoá đơn). */
function categoryOptions(selected, onlyType) {
  const group = (type, label) => `<optgroup label="${label}">${state.categories.filter(c => c.type === type)
    .map(c => `<option value="${esc(c.id)}"${c.id === selected ? ' selected' : ''}>${esc(c.icon)} ${esc(c.name)}</option>`).join('')}</optgroup>`;
  if (onlyType) return group(onlyType, onlyType === 'income' ? 'Thu' : 'Chi');
  return group('expense', 'Chi') + group('income', 'Thu');
}

// Một hoá đơn đã chia = các món + phần còn lại (tính vào danh mục của hoá đơn). Thống kê dùng từng phần.
function grossParts(t) {
  const splits = t.splits ?? [];
  const parts = splits.map(s => ({ name: s.name, amount: s.amount, category: s.category }));
  const rest = t.amount - sum(splits);
  if (rest > 0 || !splits.length) parts.push({ name: t.name, amount: splits.length ? rest : t.amount, category: t.category });
  return parts;
}
// Các phần tính theo chi thực (đã trừ phần bạn bè trả lại, chia đều theo tỉ lệ các món)
const partsOf = t => netParts(grossParts(t), t);

const timeOf = iso => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// ---------- Hồ sơ (danh mục tự thêm, phần đã học...) — lưu dạng mã hoá ----------

function applyProfile(p) {
  state.custom = p?.custom ?? emptyCustom();
  state.customUpdatedAt = p?.customUpdatedAt ?? null;
  state.learned = p?.learned ?? {};
  state.recurring = p?.recurring ?? [];
  state.wallets = p?.wallets ?? [];
  state.allocs = p?.allocs ?? [];
  state.assets = p?.assets ?? [];
  state.assetMoves = p?.assetMoves ?? [];
  state.meta = p?.meta ?? {};
  state.categories = buildCategories(state.custom);
}

const profileNow = () => ({ custom: state.custom, customUpdatedAt: state.customUpdatedAt, learned: state.learned, meta: state.meta, recurring: state.recurring,
  wallets: state.wallets, allocs: state.allocs, assets: state.assets, assetMoves: state.assetMoves });
const saveProfile = () => store.saveProfile(profileNow());

function forgetSensitive() {
  state.txs = [];
  state.tombs = [];
  applyProfile(null);
}

// ---------- Khởi động ----------

async function init() {
  // Không cho trang khác nhúng app vào iframe để lừa bấm/gõ (GitHub Pages không đặt được header chống việc này)
  if (window.top !== window.self) {
    document.body.textContent = 'Hãy mở Coin Manager trực tiếp, không qua trang khác.';
    return;
  }
  await store.init();
  state.settings = { ...DEFAULT_SETTINGS, ...(await db.get('settings', {})) };
  const resumed = gdrive.resumeAfterRedirect();

  setupTabs();
  setupSecurity();
  setupRecord();
  setupHistory();
  setupSettings();
  setupEditDialog();
  setupCalc();
  setupWallets();
  setupAssets();
  setupDebts();
  enableMouseScroll([$('#asset-strip'), $('#wallet-strip')]);
  enhanceDateInputs();
  watchDialogs();
  // Back đóng bảng đang mở → về mục lịch sử cũ; giữ địa chỉ đúng tab đang xem (để tải lại không nhảy tab)
  window.addEventListener('popstate', () => {
    if (location.hash !== `#${state.view}`) history.replaceState(history.state, '', `#${state.view}`);
  });
  document.addEventListener('click', onGlobalClick);
  document.addEventListener('visibilitychange', onVisibilityChange);
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => state.view === 'stats' && store.unlocked && renderStats(), 200);
  });
  renderAll();
  if (resumed) {
    if (resumed.error) toast(resumed.error);
    else if (resumed.action === 'restore' && !store.hasVault) restoreFromDrive();
    else if (resumed.action === 'sync') {
      pendingSync = true; // đồng bộ ngay sau khi bạn mở khoá
      toast('Đã đăng nhập Google — mở khoá để đồng bộ tiếp');
    }
  }

  // Chạy thử trên máy (localhost) thì không cache để luôn thấy code mới; thêm ?sw vào URL nếu muốn thử offline
  const dev = location.hostname === 'localhost' && !new URLSearchParams(location.search).has('sw');
  if ('serviceWorker' in navigator && !dev) navigator.serviceWorker.register('./sw.js').catch(() => {});
}

function onGlobalClick(e) {
  if (e.target.closest('[data-unlock]')) return showView(state.view, { gate: true });
  if (e.target.closest('[data-calc]')) return openCalc(e.target.closest('.amount-field').querySelector('input'));
  const wallet = e.target.closest('[data-wallet]');
  if (wallet) return openWallet(wallet.dataset.wallet);
  if (e.target.closest('[data-wallet-new]')) return openWallet();
  if (e.target.closest('[data-wallet-jars]')) return useJars();
  const asset = e.target.closest('[data-asset]');
  if (asset) return openAsset(asset.dataset.asset);
  if (e.target.closest('[data-asset-new]')) return openAsset();
  const sug = e.target.closest('[data-asset-suggest]');
  if (sug) return openAsset(null, ASSET_SUGGEST[Number(sug.dataset.assetSuggest)]);
  const tx = e.target.closest('.tx[data-id]');
  if (tx) return state.selecting && state.view === 'history' ? toggleSelect(tx.dataset.id) : openEdit(tx.dataset.id);
  const catTab = e.target.closest('[data-cat-tab]');
  if (catTab) {
    state.catTab = catTab.dataset.catTab;
    return renderStats();
  }
  const shift = e.target.closest('[data-shift]');
  if (shift) {
    state.month = shiftMonth(state.month, Number(shift.dataset.shift));
    return renderView(state.view);
  }
  const daily = e.target.closest('[data-daily]');
  if (daily) {
    state.dailyAll = daily.dataset.daily === 'all';
    return renderStats();
  }
  const cat = e.target.closest('[data-goto-cat]');
  if (cat) {
    state.histCat = cat.dataset.gotoCat;
    showView('history');
  }
}

// ---------- Tab ----------

const TABS = ['record', 'history', 'stats', 'settings'];
const TAB_NAMES = { record: 'dữ liệu', history: 'lịch sử', stats: 'thống kê', settings: 'cài đặt' };

function setupTabs() {
  $$('[data-tab]').forEach(b => b.addEventListener('click', () => showView(b.dataset.tab)));
  state.view = location.hash.slice(1) || 'record';
}

/** gate: true → hiện màn mở khoá rồi quay lại đúng tab sau khi mở. */
function showView(name, { gate = false } = {}) {
  if (!TABS.includes(name)) name = 'record';
  if (name !== 'history' && state.selecting) {
    state.selecting = false; // rời tab Lịch sử thì thôi chọn để gộp
    state.selected.clear();
  }
  $('#merge-bar').hidden = !(state.selecting && name === 'history');
  state.view = name;
  let shown = name;
  if (!store.hasVault) shown = 'setup';
  else if (!store.unlocked && (name !== 'record' || gate)) shown = 'lock';

  $$('.view').forEach(v => { v.hidden = v.dataset.view !== shown; });
  $('.tabbar').hidden = !store.hasVault;
  $$('[data-tab]').forEach(b => b.toggleAttribute('aria-current', b.dataset.tab === name));
  history.replaceState(history.state, '', `#${name}`); // giữ state: có thể đang là mục của một lớp (nút Back)
  syncSelectLayer();
  renderView(shown);
  window.scrollTo(0, 0);
}

function renderAll() {
  renderTopbar();
  showView(state.view);
}

function renderView(name) {
  if (name === 'record') renderToday();
  else if (name === 'history') renderHistory();
  else if (name === 'stats') renderStats();
  else if (name === 'settings') renderSettings();
  else if (name === 'lock') renderLock();
}

function renderTopbar() {
  const btn = $('#lock-btn');
  btn.hidden = !store.hasVault;
  btn.textContent = store.unlocked ? '🔓 Khoá' : '🔒 Mở khoá';
  btn.setAttribute('aria-label', store.unlocked ? 'Khoá ngay' : 'Mở khoá');
  const ym = monthOf(today());
  const spent = spentOf(state.txs.filter(t => monthOf(t.date) === ym));
  $('#month-spent').textContent = spent ? `T${Number(ym.slice(5))}: ${fmtCompact(spent)}` : '';
}

function renderMonthNavs() {
  const isCurrent = state.month >= monthOf(today());
  $$('[data-month-nav]').forEach(el => {
    el.innerHTML = `<button type="button" class="icon-btn" data-shift="-1" aria-label="Tháng trước">‹</button>
      <b>${monthLabel(state.month)}</b>
      <button type="button" class="icon-btn" data-shift="1" aria-label="Tháng sau"${isCurrent ? ' disabled' : ''}>›</button>`;
  });
}

// ---------- Bảo mật: tạo mật khẩu, mở khoá, tự khoá ----------

let hiddenAt = 0;
let keepUnlockedUntil = 0; // chọn file trên Android làm trang bị ẩn — đừng khoá giữa chừng

function setFormError(form, msg) {
  form.querySelector('.form-error').textContent = msg;
}

function setBusy(form, busy, label) {
  const btn = form.querySelector('button[type="submit"], button:not([type])[value="save"], button[value="ok"]');
  if (!btn) return;
  btn.dataset.label ??= btn.textContent;
  btn.disabled = busy;
  btn.textContent = busy ? label : btn.dataset.label;
}

const samePass = (a, b) => a.normalize('NFC') === b.normalize('NFC');

function setupSecurity() {
  $('#lock-btn').addEventListener('click', () => (store.unlocked ? lockNow() : showView(state.view, { gate: true })));

  $('#setup-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const pass = f.elements.pass.value;
    const issue = passphraseIssues(pass);
    if (issue) return setFormError(f, issue);
    if (!samePass(pass, f.elements.pass2.value)) return setFormError(f, 'Hai lần nhập không khớp.');
    setFormError(f, '');
    setBusy(f, true, 'Đang tạo khoá…');
    try {
      await store.setup(pass);
      await saveProfile();
      f.reset();
      renderAll();
      toast('Đã bật mã hoá. Hãy nhớ kỹ mật khẩu!');
    } catch (err) {
      setFormError(f, `Không tạo được khoá: ${err.message}`);
    } finally {
      setBusy(f, false);
    }
  });

  $('#unlock-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    setFormError(f, '');
    setBusy(f, true, 'Đang mở khoá…');
    if (state.settings.googleConnected && state.settings.autoSync) gdrive.preload();
    try {
      await store.unlock(f.elements.pass.value);
    } catch (err) {
      setBusy(f, false);
      f.elements.pass.select();
      return setFormError(f, err instanceof WrongPassphrase ? 'Sai mật khẩu.' : `Lỗi: ${err.message}`);
    }
    f.reset();
    try {
      await loadUnlockedData();
    } finally {
      setBusy(f, false);
    }
    renderAll();
    autoSyncAfterUnlock();
  });

  $('#restore-file').addEventListener('click', () => { keepUnlockedUntil = Date.now() + 120_000; });
  $('#restore-file').addEventListener('change', restoreOnNewDevice);
  $('#restore-drive').addEventListener('pointerdown', () => gdrive.preload());
  $('#restore-drive').addEventListener('click', restoreFromDrive);
  $('#forgot-wipe').addEventListener('click', () => wipeEverything(
    'Xoá toàn bộ dữ liệu đã mã hoá trên máy này và tạo mật khẩu mới?\nKhông thể hoàn tác.',
  ));

  const dlg = $('#change-pass-dialog');
  const cf = $('#change-pass-form');
  $('#change-pass').addEventListener('click', () => {
    cf.reset();
    setFormError(cf, '');
    dlg.showModal();
  });
  cf.addEventListener('submit', async e => {
    e.preventDefault();
    if (e.submitter?.value === 'cancel') return dlg.close();
    const { old, pass, pass2 } = cf.elements;
    const issue = passphraseIssues(pass.value);
    if (issue) return setFormError(cf, issue);
    if (!samePass(pass.value, pass2.value)) return setFormError(cf, 'Hai lần nhập mật khẩu mới không khớp.');
    if (samePass(pass.value, old.value)) return setFormError(cf, 'Mật khẩu mới trùng mật khẩu cũ.');
    setBusy(cf, true, 'Đang đổi…');
    try {
      await store.changePassphrase(old.value, pass.value);
      dlg.close();
      toast('Đã đổi mật khẩu. Bản sao lưu cũ vẫn mở bằng mật khẩu cũ.');
    } catch (err) {
      setFormError(cf, err instanceof WrongPassphrase ? 'Mật khẩu hiện tại không đúng.' : `Lỗi: ${err.message}`);
    } finally {
      setBusy(cf, false);
    }
  });
}

function renderLock() {
  const f = $('#unlock-form');
  setFormError(f, '');
  $('#lock-msg').textContent = `Nhập mật khẩu để xem ${TAB_NAMES[state.view]}.`;
  setTimeout(() => f.elements.pass.focus(), 50);
}

async function loadUnlockedData() {
  applyProfile(await store.loadProfile());
  const { txs, failed } = await store.loadTx();
  state.txs = txs.filter(t => !isTomb(t));
  state.tombs = txs.filter(isTomb);
  const inbox = await ingestInbox();
  if (failed + inbox.failed) toast(`Bỏ qua ${failed + inbox.failed} khoản lỗi hoặc không hợp lệ`);
  else if (inbox.count) toast(`Đã thêm ${inbox.count} khoản ghi lúc đang khoá`);
  await runRecurring();
}

// Khoản ghi lúc đang khoá chưa có danh mục tự thêm / phần đã học → phân loại lại nếu bạn không tự chọn
// Ghi lúc đang khoá thì chưa đọc được danh sách tài sản (nằm trong hồ sơ đã mã hoá) →
// mở khoá xong mới nhận diện, theo từng câu nói ("bánh 25 nước 25 tiền mặt": cả hai khoản dùng Tiền mặt)
function resolveInboxAssets(list) {
  const groups = new Map();
  for (const t of list) {
    if (!t.assetAuto || t.assetId) continue;
    const key = `${t.createdAt}|${t.raw}`;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  const def = defaultAsset(state.assets)?.id;
  for (const g of groups.values()) {
    const named = assignAssets(g.map(t => ({ name: t.name.toLowerCase() })), state.assets);
    g.forEach((t, i) => {
      if (named[i].name !== t.name.toLowerCase()) t.name = capitalize(named[i].name) || catById(t.category).name;
      const id = named[i].assetId ?? def;
      if (id) t.assetId = id;
    });
  }
}

function finalizeInboxItem({ catAuto, assetAuto, ...t }) {
  if (catAuto) {
    const c = classify(t.name, state.categories, state.learned);
    if (c && catById(c).type === t.type) t.category = c;
  }
  return t;
}

async function ingestInbox() {
  const { items, failed } = await store.loadInbox();
  if (!items.length) return { count: 0, failed };
  // Ai cùng origin cũng ghi được vào hộp chờ (khoá công khai để dạng thường) → chỉ nhận khoản hợp lệ
  const valid = items.filter(isValidTx);
  resolveInboxAssets(valid);
  const txs = valid.map(finalizeInboxItem);
  await store.putTx(txs);                       // ghi trước, xoá hộp chờ sau → không mất nếu bị ngắt giữa chừng
  await store.deleteInbox(items.map(i => i.id));
  mergeTxs(txs);
  await learnFrom(valid.filter(i => !i.catAuto));
  return { count: txs.length, failed: failed + items.length - valid.length };
}

function mergeTxs(list) {
  const byId = new Map(state.txs.map(t => [t.id, t]));
  list.forEach(t => byId.set(t.id, t));
  state.txs = [...byId.values()];
}

function lockNow() {
  if (!store.unlocked) return;
  store.lock();
  gdrive.forgetToken();
  forgetSensitive();
  $$('dialog[open]').forEach(d => d.close());
  // Các tab đã xem vẫn còn số liệu trong DOM (chỉ bị ẩn) — xoá hẳn
  for (const sel of ['#hist-list', '#hist-summary', '#stats-body', '#today-list', '#cat-settings', '#learned-list', '#data-info', '#split-list', '#split-rest', '#rec-list', '#rec-total',
    '#wallet-strip', '#wallet-free', '#wallet-stat', '#wallet-history', '#wallet-cats', '#alloc-rows', '#alloc-income', '#alloc-rest', '#move-hint']) {
    $(sel).replaceChildren();
  }
  editSplits = [];
  $$('form').forEach(f => f.reset());
  state.histQ = '';
  state.selecting = false;
  state.selected.clear();
  $('#merge-bar').hidden = true;
  renderAll();
}

function onVisibilityChange() {
  if (document.hidden) {
    hiddenAt = Date.now();
    if (state.settings.lockAfter === 0 && Date.now() > keepUnlockedUntil) lockNow();
  } else if (store.unlocked && hiddenAt && Date.now() > keepUnlockedUntil
    && Date.now() - hiddenAt >= state.settings.lockAfter * 60_000) {
    lockNow();
  } else if (store.unlocked) {
    runRecurring().then(n => { if (n) { renderTopbar(); renderView(state.view); } });
  }
}

async function wipeEverything(message) {
  if (!confirm(message)) return;
  await store.wipe();
  gdrive.forgetToken();
  state.settings.googleConnected = false;
  await db.set('settings', state.settings);
  forgetSensitive();
  clearPreview();
  renderAll();
  toast('Đã xoá toàn bộ dữ liệu');
}

function askPassphrase(message, verify) {
  const dlg = $('#ask-pass-dialog');
  const f = $('#ask-pass-form');
  f.reset();
  setFormError(f, '');
  $('#ask-pass-msg').textContent = message;
  dlg.showModal();
  return new Promise(resolve => {
    const finish = value => {
      f.removeEventListener('submit', onSubmit);
      dlg.removeEventListener('close', onClose);
      if (dlg.open) dlg.close();
      resolve(value);
    };
    const onClose = () => finish(null);
    const onSubmit = async e => {
      e.preventDefault();
      if (e.submitter?.value === 'cancel') return finish(null);
      setBusy(f, true, 'Đang mở…');
      try {
        finish(await verify(f.elements.pass.value));
      } catch (err) {
        setFormError(f, err instanceof WrongPassphrase ? 'Sai mật khẩu.' : `Không mở được: ${err.message}`);
      } finally {
        setBusy(f, false);
      }
    };
    f.addEventListener('submit', onSubmit);
    dlg.addEventListener('close', onClose);
  });
}

// ---------- Ghi bằng giọng nói ----------

let recognizer = null;
let gotResult = false;
let autoSaveTimer = null;
let batchSeq = 0;

const DEFAULT_STATUS = 'Đọc các món kèm giá, ví dụ <q>bánh 25 nước ngọt 25</q>';

// Bảng ghi nhanh nổi ngay trên nút micro (trong tầm ngón cái), dùng được ở mọi tab
let captureLayer = null;

function showCapture(on) {
  $('#capture').hidden = !on;
  document.body.classList.toggle('capturing', on);
  // Back = bấm ✕
  if (on && !captureLayer) captureLayer = openLayer(() => $('#cap-close').click());
  else if (!on && captureLayer) {
    captureLayer();
    captureLayer = null;
  }
}

function setMicStatus(html, isError = false) {
  const el = $('#mic-status');
  el.innerHTML = html;
  el.classList.toggle('error', isError);
}

function showTranscript(text, interim) {
  const el = $('#transcript');
  el.hidden = !text;
  el.textContent = text ? `“${text}”` : '';
  el.classList.toggle('interim', interim);
}

function setupRecord() {
  const mic = $('#mic');
  recognizer = createRecognizer({
    onInterim: t => showTranscript(t, true),
    onFinal: alts => { gotResult = true; handleAlternatives(alts, 'voice'); },
    onError: err => { gotResult = true; if (VOICE_ERRORS[err] !== '') setMicStatus(esc(VOICE_ERRORS[err] ?? `Lỗi nhận giọng nói: ${err}`), true); },
    onEnd: () => {
      mic.classList.remove('listening');
      mic.setAttribute('aria-label', 'Bấm để nói');
      // Không nghe được gì và chưa có gì chờ lưu → đóng bảng
      if (!gotResult && !state.preview) showCapture(false);
    },
  });

  if (!recognizer) {
    mic.disabled = true;
    $('.mic-hint').innerHTML = 'Trình duyệt này không hỗ trợ nhận giọng nói. Hãy mở bằng <b>Chrome trên Android</b>, hoặc gõ tay bên dưới.';
  }
  mic.addEventListener('click', () => {
    if (recognizer.listening) return recognizer.stop();
    cancelAutoSave();
    gotResult = false;
    try {
      recognizer.start();
      mic.classList.add('listening');
      mic.setAttribute('aria-label', 'Bấm để dừng');
      setMicStatus('🎤 Đang nghe… đọc tên món rồi giá');
      showTranscript('', true);
      $('#alts').hidden = true;
      showCapture(true);
    } catch {
      setMicStatus('Không mở được micro, thử lại nhé.', true);
    }
  });

  $('#text-form').addEventListener('submit', e => {
    e.preventDefault();
    const input = $('#text-input');
    if (!input.value.trim()) return;
    handleAlternatives([input.value.trim()], 'typed');
    input.value = '';
  });

  const pv = $('#preview');
  pv.addEventListener('input', onPreviewEdit);
  pv.addEventListener('change', onPreviewEdit);
  pv.addEventListener('pointerdown', cancelAutoSave);
  pv.addEventListener('focusin', cancelAutoSave);
  $('#preview-items').addEventListener('click', e => {
    const del = e.target.closest('.pv-del');
    if (!del) return;
    state.preview.items.splice(Number(del.dataset.i), 1);
    state.preview.items.length ? renderPreview() : clearPreview();
  });
  $('#pv-cancel').addEventListener('click', clearPreview);
  $('#cap-close').addEventListener('click', () => {
    if (recognizer?.listening) recognizer.stop();
    clearPreview();
    showCapture(false);
  });
  $('#pv-save').addEventListener('click', savePreview);
}

// Khoản chi có thể là khoản được hoàn / ghi nợ: khớp tên trước, rồi các khoản gần đây để chọn tay
function refundCandidates(item) {
  const sure = matchTargets(item, state.txs, today());
  const ids = [...new Set([...sure.slice(0, 6).map(m => m.tx.id),
    ...recentExpenses(state.txs, item.kind === 'refund' ? item.amount : 0).map(t => t.id)])].slice(0, 12);
  return { ids, best: sure[0]?.sure ? sure[0].tx.id : '' };
}

/**
 * Một câu nói → các dòng chờ lưu:
 *  - khoản chi / thu ("thịt bò năm mươi nghìn tiền mặt"), có thể kèm ai nợ ("lẩu 500 lâm nợ 250")
 *  - hoàn tiền cho khoản cũ ("tiền mua game đã được anh Lâm trả lại 257k") — kind 'refund'
 *  - ghi nợ cho khoản cũ ("lâm nợ tiền lẩu 250") — kind 'owe'
 * Đang khoá: chưa đọc được khoản cũ → câu hoàn tiền / ghi nợ trả về kind 'locked' (cần mở khoá).
 */
function toPreviewItems(raw, parsed, batch) {
  // "thịt bò năm mươi nghìn tiền mặt" → tên "thịt bò", trừ vào Tiền mặt (đang khoá: chưa có danh sách tài sản, nhận diện sau)
  const def = defaultAsset(state.assets)?.id ?? '';
  const known = knownPeople(state.txs);
  const unlocked = store.unlocked;
  // Thứ tự: tách tài sản → giảm giá ("pizza 300 giảm 50") → ai nợ (tính trên số đã trả)
  return extractOwes(extractDiscounts(assignAssets(parsed.items, state.assets))).map(it => {
    if (parsed.type !== 'expense' && !it.owes) {
      const r = parsed.type === 'income' ? null : detectRefund(it.name, { known, strict: unlocked });
      const o = r || parsed.type ? null : detectOwe(it.name, { known });
      if ((r || o) && !unlocked) return { kind: 'locked', name: it.name, amount: it.amount, raw, batch };
      if (r) {
        const item = { kind: 'refund', person: r.person, target: r.target, amount: it.amount, assetId: it.assetId ?? def, raw, batch };
        const c = refundCandidates(item);
        return { ...item, candidates: c.ids, txId: c.best };
      }
      if (o) {
        const item = { kind: 'owe', person: o.person, target: o.target, amount: it.amount, raw, batch };
        const c = refundCandidates(item);
        return { ...item, candidates: c.ids, txId: c.best };
      }
    }
    let category = classify(it.name, state.categories, state.learned);
    const type = parsed.type ?? (category ? catById(category).type : 'expense');
    if (!category || catById(category).type !== type) category = FALLBACK[type];
    return {
      kind: 'tx', name: capitalize(it.name), amount: it.amount, category, suggested: category, assetId: it.assetId ?? def,
      ...(it.owes && type === 'expense' ? { owes: it.owes } : {}), ...(it.discount && type === 'expense' ? { discount: it.discount } : {}), raw, batch,
    };
  });
}

function handleAlternatives(alts, source) {
  const opts = { slang: state.settings.slang };
  const seen = new Set();
  const parsed = alts.filter(t => !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))
    .map(t => ({ t, r: parseUtterance(prepPercent(t), opts) }));
  const best = parsed.find(p => p.r.items.length) ?? parsed[0];
  showCapture(true);
  showTranscript(best.t, false);

  if (!best.r.items.length) {
    setMicStatus('Chưa nghe ra số tiền. Thử nói kèm đơn vị, ví dụ <q>mười lăm nghìn</q>.', true);
    return;
  }
  const batch = ++batchSeq;
  const all = toPreviewItems(best.t, best.r, batch);
  const items = all.filter(it => it.kind !== 'locked');
  if (!items.length) {
    // Câu hoàn tiền / ghi nợ lúc đang khoá: phải đọc được các khoản cũ mới biết hoàn cho khoản nào
    setMicStatus('↩️ Câu này là hoàn tiền / ghi nợ cho khoản cũ — <button type="button" class="btn chip-btn" data-unlock>Mở khoá</button> rồi nói lại nhé.', true);
    return;
  }
  setMicStatus(items.length < all.length ? 'Phần hoàn tiền cần mở khoá mới ghi được — kiểm tra phần còn lại rồi bấm <b>Lưu</b>'
    : 'Kiểm tra lại rồi bấm <b>Lưu</b>');

  // Câu mới được thêm vào phần đang chờ lưu, không ghi đè
  if (!state.preview) state.preview = { items: [], date: today() };
  state.preview.items.push(...items);
  if (best.r.dateOffset) state.preview.date = addDays(today(), best.r.dateOffset);
  renderPreview();
  renderAlts(parsed.filter(p => p !== best && p.r.items.length).slice(0, 3), batch);

  // Tự lưu chỉ cho khoản thường — hoàn tiền / ghi nợ cần nhìn lại xem đúng khoản chưa
  if (source === 'voice' && state.settings.autoSave && state.preview.items.every(it => it.kind === 'tx' && it.amount > 0 && it.name)) {
    startAutoSave();
  }
}

// Các phương án khác mà bộ nhận giọng nói đưa ra — chạm để thay
function renderAlts(options, batch) {
  const el = $('#alts');
  el.hidden = !options.length;
  el.innerHTML = options.length ? `<span class="muted">Hay ý bạn là:</span>${options.map((o, i) =>
    `<button type="button" class="chip" data-alt="${i}">${esc(o.t)}</button>`).join('')}` : '';
  el.onclick = e => {
    const b = e.target.closest('[data-alt]');
    if (!b || !state.preview) return;
    const o = options[Number(b.dataset.alt)];
    state.preview.items = state.preview.items.filter(it => it.batch !== batch)
      .concat(toPreviewItems(o.t, o.r, batch).filter(it => it.kind !== 'locked'));
    showTranscript(o.t, false);
    el.hidden = true;
    renderPreview();
  };
}

function renderPreview() {
  const p = state.preview;
  $('#preview').hidden = false;
  $('#pv-date').value = p.date;
  const withAssets = store.unlocked && liveAssets(state.assets).length > 0;
  $('#preview-items').innerHTML = p.items.map((it, i) => (it.kind === 'refund' || it.kind === 'owe' ? previewDebtRow(it, i, withAssets) : `
    <div class="pv-item${it.amount > 0 ? '' : ' warn'}" data-i="${i}">
      <div class="pv-top${withAssets ? ' with-asset' : ''}">
        <input class="pv-name" data-f="name" value="${esc(it.name)}" placeholder="Tên khoản" aria-label="Tên khoản">
        ${withAssets ? `<select class="pv-asset" data-f="assetId" aria-label="Tài sản">${assetOptions(it.assetId)}</select>` : ''}
      </div>
      <div class="pv-row">
        <span class="amount-field"><input data-f="amount" value="${it.amount ? fmtNum(it.amount) : ''}" placeholder="Số tiền" aria-label="Số tiền" autocomplete="off"><span>đ</span><button type="button" class="calc-btn" data-calc aria-label="Mở máy tính">🧮</button></span>
        <select data-f="category" aria-label="Danh mục">${categoryOptions(it.category)}</select>
        <button class="icon-btn pv-del" type="button" data-i="${i}" aria-label="Bỏ khoản này">✕</button>
      </div>
      ${previewNotes(it)}
    </div>`)).join('');
  updateSaveButton();
}


/** Dòng nhỏ dưới khoản trong bảng xem trước: giảm giá, ai nợ. */
function previewNotes(it) {
  const notes = [];
  if (it.discount > 0) notes.push(`🏷️ Giảm ${fmtVND(it.discount)} · giá gốc ${fmtVND(it.amount + it.discount)}`);
  if (it.owes?.length) notes.push(`🤝 ${it.owes.map(o => `${o.person} nợ ${fmtVND(o.amount)}`).join(' · ')}`);
  return notes.map(n => `<p class="pv-note">${esc(n)}</p>`).join('');
}

/** "Tiền mua game · 500k · 15/10 · Lâm nợ 257k" */
function txChoiceLabel(t, person) {
  const left = person ? owedOn(t).get(personKey(person))?.left : 0;
  const refunded = refundedOf(t);
  return `${t.name} · ${fmtCompact(t.amount)} · ${shortDate(t.date)}${left ? ` · ${person} nợ ${fmtCompact(left)}` : ''}`
    + (refunded ? ` · đã hoàn ${fmtCompact(refunded)}` : '');
}

// Dòng hoàn tiền / ghi nợ cho khoản cũ trong bảng xem trước
function previewDebtRow(it, i, withAssets) {
  const refund = it.kind === 'refund';
  const txs = it.candidates.map(id => state.txs.find(t => t.id === id)).filter(Boolean);
  const opt = (id, label) => `<option value="${esc(id)}"${id === it.txId ? ' selected' : ''}>${esc(label)}</option>`;
  const options = opt('', it.target ? `Chọn khoản “${it.target}”…` : 'Chọn khoản chi…')
    + txs.map(t => opt(t.id, txChoiceLabel(t, it.person))).join('')
    + (refund ? opt(INCOME_CHOICE, 'Không thuộc khoản nào — ghi là khoản thu') : '');
  const ok = it.amount > 0 && it.txId;
  return `<div class="pv-item pv-debt${ok ? '' : ' warn'}" data-i="${i}">
      <p class="pv-kind">${refund ? '↩️ Được trả lại' : '🤝 Ghi nợ'}</p>
      <div class="pv-top">
        <input class="pv-name" data-f="person" value="${esc(it.person)}" placeholder="Ai?" aria-label="Người ${refund ? 'trả' : 'nợ'}">
      </div>
      <select class="pv-target" data-f="txId" aria-label="Khoản chi">${options}</select>
      <div class="pv-row${refund && withAssets ? '' : ' no-cat'}">
        <span class="amount-field"><input data-f="amount" value="${it.amount ? fmtNum(it.amount) : ''}" placeholder="Số tiền" aria-label="Số tiền" autocomplete="off"><span>đ</span><button type="button" class="calc-btn" data-calc aria-label="Mở máy tính">🧮</button></span>
        ${refund && withAssets ? `<select data-f="assetId" aria-label="Về tài sản">${assetOptions(it.assetId, 'Không tính vào tài sản')}</select>` : ''}
        <button class="icon-btn pv-del" type="button" data-i="${i}" aria-label="Bỏ dòng này">✕</button>
      </div>
    </div>`;
}
const INCOME_CHOICE = '__income';

function onPreviewEdit(e) {
  const p = state.preview;
  if (!p) return;
  if (e.target.id === 'pv-date') { p.date = e.target.value || today(); return; }
  const row = e.target.closest('.pv-item');
  const f = e.target.dataset.f;
  if (!row || !f) return;
  const it = p.items[Number(row.dataset.i)];
  if (f === 'amount') {
    it.amount = parseAmountInput(e.target.value, { slang: state.settings.slang }) ?? 0;
    if (e.type === 'change' && it.amount) e.target.value = fmtNum(it.amount);
  } else {
    it[f] = e.target.value;
  }
  row.classList.toggle('warn', !previewItemOk(it));
  updateSaveButton();
}

const previewItemOk = it => it.amount > 0 && (it.kind === 'tx' || (!!it.txId && !!it.person?.trim()));

function updateSaveButton(countdown) {
  const items = state.preview?.items ?? [];
  const ok = items.length && items.every(previewItemOk);
  const btn = $('#pv-save');
  btn.disabled = !ok;
  const total = sum(items.filter(it => it.amount > 0));
  btn.textContent = `Lưu${items.length > 1 ? ` ${items.length} khoản` : ''} · ${fmtVND(total)}${countdown ? ` (${countdown})` : ''}`;
}

function startAutoSave() {
  cancelAutoSave();
  let n = 3;
  updateSaveButton(n);
  autoSaveTimer = setInterval(() => {
    n -= 1;
    if (n > 0) return updateSaveButton(n);
    cancelAutoSave();
    savePreview();
  }, 1000);
}

function cancelAutoSave() {
  if (!autoSaveTimer) return;
  clearInterval(autoSaveTimer);
  autoSaveTimer = null;
  updateSaveButton();
}

function clearPreview() {
  cancelAutoSave();
  state.preview = null;
  $('#preview').hidden = true;
  $('#alts').hidden = true;
  showTranscript('', false);
  if (!recognizer?.listening) showCapture(false);
}

async function savePreview() {
  cancelAutoSave();
  const p = state.preview;
  if (!p || !p.items.length || !p.items.every(previewItemOk)) return;
  const unlocked = store.unlocked;
  if (!unlocked && p.items.some(it => it.kind !== 'tx')) return;
  const now = new Date().toISOString();
  const plain = p.items.filter(it => it.kind === 'tx' || (it.kind === 'refund' && it.txId === INCOME_CHOICE));
  const txs = plain.map(it => {
    if (it.kind === 'refund') {
      // Tiền trả lại không thuộc khoản chi nào → ghi là khoản thu
      const cat = catById(FALLBACK.income);
      return {
        id: crypto.randomUUID(), date: p.date, name: `${displayPerson(it.person)} trả lại`, amount: it.amount, category: cat.id, type: 'income',
        ...(it.assetId ? { assetId: it.assetId } : {}), raw: it.raw, createdAt: now, updatedAt: now,
      };
    }
    const cat = catById(it.category);
    return {
      id: crypto.randomUUID(), date: p.date, name: capitalize(it.name.trim()) || cat.name, amount: it.amount,
      category: cat.id, type: cat.type, ...(it.assetId ? { assetId: it.assetId } : {}),
      ...(it.owes?.length && cat.type === 'expense' ? { owes: it.owes } : {}),
      ...(it.discount > 0 && cat.type === 'expense' ? { discount: it.discount } : {}), raw: it.raw, createdAt: now, updatedAt: now,
    };
  });
  // Hoàn tiền / ghi nợ cho khoản cũ: sửa khoản đó (giữ bản cũ để hoàn tác)
  const originals = new Map();
  const updated = new Map();
  for (const it of p.items) {
    if ((it.kind !== 'refund' && it.kind !== 'owe') || it.txId === INCOME_CHOICE) continue;
    const base = updated.get(it.txId) ?? state.txs.find(t => t.id === it.txId);
    if (!base) continue;
    if (!originals.has(base.id)) originals.set(base.id, base);
    const person = displayPerson(it.person);
    const t = { ...base, updatedAt: now };
    if (it.kind === 'refund') {
      t.refunds = [...(base.refunds ?? []), {
        id: crypto.randomUUID(), person, amount: Math.min(it.amount, netAmount(base)), ...(it.assetId ? { assetId: it.assetId } : {}),
        date: p.date, createdAt: now,
      }];
    } else {
      t.owes = [...(base.owes ?? []), { id: crypto.randomUUID(), person, amount: Math.min(it.amount, base.amount) }];
    }
    updated.set(t.id, t);
  }
  // Dọn khung chờ ngay (trước khi await) để câu nói kế tiếp không bị cuốn theo
  clearPreview();
  setMicStatus(DEFAULT_STATUS);
  try {
    if (unlocked) await store.putTx([...txs, ...updated.values()]);
    // Đang khoá: mã hoá một chiều vào hộp chờ, mở khoá xong mới đọc được
    else await store.addToInbox(txs.map((t, i) => ({ ...t, catAuto: plain[i].category === plain[i].suggested, assetAuto: !t.assetId })));
  } catch {
    state.preview = state.preview ? { ...state.preview, items: [...p.items, ...state.preview.items] } : p;
    renderPreview();
    toast('Không lưu được, thử lại nhé');
    return;
  }
  let note = '';
  const done = [];
  if (unlocked) {
    state.txs = [...state.txs.map(t => updated.get(t.id) ?? t), ...txs];
    await learnFrom(txs.filter((t, i) => plain[i].kind === 'tx'));
    renderTopbar();
    for (const it of p.items) {
      const t = updated.get(it.txId);
      if (t) done.push(it.kind === 'refund' ? `↩️ ${displayPerson(it.person)} trả ${fmtCompact(it.amount)} cho “${t.name}”` : `🤝 ${displayPerson(it.person)} nợ ${fmtCompact(it.amount)} “${t.name}”`);
    }
    const refundTxs = [...updated.values()].map(t => ({ assetId: t.refunds?.at(-1)?.assetId })).filter(x => x.assetId);
    note = assetNote([...txs, ...refundTxs]) + walletNote(txs);
  }
  // Có thể ghi từ tab bất kỳ → vẽ lại đúng tab đang xem
  renderView(state.view);
  navigator.storage?.persist?.();
  const ids = txs.map(t => t.id);
  const head = [txs.length ? `Đã lưu ${txs.length > 1 ? `${txs.length} khoản · ` : ''}${fmtVND(sum(txs))}` : '', ...done].filter(Boolean).join(' · ');
  toast(`${head}${unlocked ? note : ' (đã mã hoá)'}`, {
    action: 'Hoàn tác',
    onAction: async () => {
      if (!unlocked) return store.deleteInbox(ids).then(renderToday);
      if (originals.size) await restoreTxs([...originals.values()]);
      if (ids.length) await removeTx(ids);
      else toast('Đã hoàn tác');
    },
  });
}

/** Trả các khoản về bản cũ (hoàn tác hoàn tiền / ghi nợ). */
async function restoreTxs(list) {
  const now = new Date().toISOString();
  const back = list.map(t => ({ ...t, updatedAt: now }));
  await store.putTx(back);
  const byId = new Map(back.map(t => [t.id, t]));
  state.txs = state.txs.map(t => byId.get(t.id) ?? t);
  renderTopbar();
  renderView(state.view);
}

// Ghi nhớ khi bạn chọn danh mục khác với gợi ý từ khoá
async function learnFrom(txs) {
  let changed = false;
  for (const t of txs) {
    const key = normalize(t.name);
    if (!key) continue;
    const suggested = classify(t.name, state.categories, {}) ?? FALLBACK[t.type];
    if (t.category !== suggested && state.learned[key] !== t.category) {
      state.learned[key] = t.category;
      changed = true;
    } else if (t.category === suggested && key in state.learned) {
      delete state.learned[key];
      changed = true;
    }
  }
  if (changed && store.unlocked) await saveProfile();
}

async function removeTx(ids) {
  // Không xoá hẳn: để lại dấu xoá (đã mã hoá) để máy khác cũng xoá khi đồng bộ
  const now = new Date().toISOString();
  const tombs = ids.map(id => ({ id, deleted: true, updatedAt: now }));
  await store.putTx(tombs);
  const set = new Set(ids);
  state.txs = state.txs.filter(t => !set.has(t.id));
  state.tombs = [...state.tombs.filter(t => !set.has(t.id)), ...tombs];
  renderTopbar();
  renderView(state.view);
  toast(`Đã xoá ${ids.length} khoản`);
}

/** "↩️ Anh Lâm trả 257k · 🤝 Hùng còn nợ 100k · chi thực 243k" */
function debtLine(t) {
  if (!t.owes?.length && !t.refunds?.length && !(t.discount > 0)) return '';
  const bits = [];
  for (const e of owedOn(t).values()) {
    if (e.paid) bits.push(`↩️ ${e.name} trả ${fmtCompact(e.paid)}`);
    if (e.left) bits.push(`🤝 ${e.name} còn nợ ${fmtCompact(e.left)}`);
  }
  if (refundedOf(t)) bits.push(`chi thực ${fmtCompact(netAmount(t))}`);
  if (t.discount > 0) bits.push(`🏷️ giảm ${fmtCompact(t.discount)} (gốc ${fmtCompact(originalOf(t))})`);
  return `<span class="tx-splits tx-debt">${esc(bits.join(' · '))}</span>`;
}

function txItem(t, { showDate = false, timeline = false } = {}) {
  const c = catById(t.category);
  const sign = t.type === 'income' ? '+' : '−';
  const asset = t.assetId ? assetById(t.assetId) : null;
  const sub = (t.recurringId ? '🔁 ' : '') + (showDate ? `${dayLabel(t.date)} · ${c.name}` : c.name) + (asset ? ` · ${asset.icon} ${asset.name}` : '');
  const splits = (t.splits?.length
    ? `<span class="tx-splits">${t.splits.map(s => `${esc(s.name)} ${fmtCompact(s.amount)}`).join(' · ')}</span>` : '') + debtLine(t);
  const btn = `<button type="button" class="tx tint-${c.tint}" data-id="${esc(t.id)}">
    <span class="tx-icon" aria-hidden="true">${esc(c.icon)}</span>
    <span class="tx-main"><span class="tx-name">${esc(t.name)}</span><span class="tx-sub">${esc(sub)}</span>${splits}</span>
    <span class="tx-amt ${t.type === 'income' ? 'income' : 'expense'}">${sign}${fmtVND(t.amount)}</span>
  </button>`;
  return timeline ? `<li class="tl"><span class="tl-time">${timeOf(t.createdAt)}</span>${btn}</li>` : `<li>${btn}</li>`;
}

function renderSummary() {
  const ym = monthOf(today());
  const label = `tháng ${Number(ym.slice(5))}`;
  $('#sum-exp-label').textContent = `Chi ${label}`;
  $('#sum-inc-label').textContent = `Thu ${label}`;
  if (!store.unlocked) {
    $('#sum-exp').textContent = '🔒';
    $('#sum-inc').textContent = '🔒';
    return;
  }
  const month = state.txs.filter(t => monthOf(t.date) === ym);
  $('#sum-exp').textContent = fmtVND(spentOf(month));
  $('#sum-inc').textContent = fmtVND(sum(month.filter(t => t.type === 'income')));
}

async function renderToday() {
  renderSummary();
  renderAssets();
  renderDebts();
  renderWallets();
  if (!store.unlocked) {
    $('#today-total').textContent = '';
    const n = store.hasVault ? await store.inboxCount() : 0;
    $('#today-list').innerHTML = `<li class="locked-note">
      <span>🔒 Dữ liệu đang khoá — bạn vẫn ghi được, nhưng cần mật khẩu để xem.${n ? ` Có <b>${n}</b> khoản mới ghi đang chờ.` : ''}</span>
      <button type="button" class="btn primary" data-unlock>Mở khoá</button></li>`;
    return;
  }
  const t = today();
  const list = state.txs.filter(x => x.date === t).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const spent = spentOf(list);
  $('#today-total').textContent = list.length ? `đã chi ${fmtVND(spent)}` : '';
  $('#today-merge').hidden = list.length < 2;
  $('#today-list').innerHTML = list.length
    ? list.map(x => txItem(x, { timeline: true })).join('')
    : '<li class="empty">🦆 Chưa có khoản nào hôm nay. Bấm micro và nói thử nhé!</li>';
}

// ---------- Lịch sử ----------

function setupHistory() {
  $('#hist-q').addEventListener('input', e => { state.histQ = e.target.value; renderHistory(); });
  $('#hist-cat').addEventListener('change', e => { state.histCat = e.target.value; renderHistory(); });
  $('#hist-asset').addEventListener('change', e => { state.histAsset = e.target.value; renderHistory(); });
  $('#select-btn').addEventListener('click', () => (state.selecting ? stopSelecting() : startSelecting()));
  $('#merge-cancel').addEventListener('click', stopSelecting);
  $('#merge-go').addEventListener('click', openMerge);
  $('#today-merge').addEventListener('click', () => {
    state.month = monthOf(today());
    showView('history');
    startSelecting();
  });
  setupMerge();
}

function renderHistory() {
  renderMonthNavs();
  $('#hist-cat').innerHTML = `<option value="">Tất cả danh mục</option>${categoryOptions(state.histCat)}`;
  $('#hist-cat').value = state.histCat;
  // Lọc theo tài sản: chỉ hiện khi đã có tài sản (hoặc đang lọc dở)
  const hasAssets = liveAssets(state.assets).length > 0 || !!state.histAsset;
  $('#hist-asset').hidden = !hasAssets;
  $('.filters').classList.toggle('has-asset', hasAssets);
  if (hasAssets) $('#hist-asset').innerHTML = assetOptions(state.histAsset, 'Tất cả tài sản');
  const q = normalize(state.histQ);
  const cat = state.histCat;
  const asset = state.histAsset;
  const names = t => [t.name, ...(t.splits ?? []).map(s => s.name)];
  const list = state.txs
    .filter(t => monthOf(t.date) === state.month
      && (!cat || partsOf(t).some(p => p.category === cat))
      && (!asset || t.assetId === asset)
      && (!q || names(t).some(n => normalize(n).includes(q))))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));

  if (cat) {
    // Lọc theo danh mục: chỉ cộng phần thuộc danh mục đó (một hoá đơn có thể chia cho nhiều danh mục)
    const inCat = sum(list.flatMap(partsOf).filter(p => p.category === cat));
    $('#hist-summary').textContent = list.length ? `${list.length} khoản · ${fmtVND(inCat)} thuộc ${catById(cat).name}` : '';
  } else {
    const spent = spentOf(list);
    const earned = sum(list.filter(t => t.type === 'income'));
    $('#hist-summary').textContent = list.length
      ? `${list.length} khoản · chi ${fmtVND(spent)}${earned ? ` · thu ${fmtVND(earned)}` : ''}`
      : '';
  }

  const groups = new Map();
  for (const t of list) groups.set(t.date, [...(groups.get(t.date) ?? []), t]);
  $('#hist-list').innerHTML = list.length ? [...groups].map(([date, items]) => {
    const daySpent = spentOf(items);
    return `<section class="card day-group">
      <h3 class="card-title"><span>${dayLabel(date)}</span><span class="muted">${daySpent ? `−${fmtVND(daySpent)}` : ''}</span></h3>
      <ul class="tx-list timeline">${items.map(t => txItem(t, { timeline: true })).join('')}</ul>
    </section>`;
  }).join('') : '<p class="empty card">🦆 Không có khoản nào.</p>';
  renderSelection();
}

// ---------- Thống kê ----------

// Donut tối đa 6 phần (khuyến nghị dataviz: nhiều hơn thì khó so bằng mắt):
// 5 danh mục lớn nhất + "Khác" gộp phần còn lại (kể cả danh mục Khác có sẵn để không bị hai chữ "Khác")
const DONUT_MAX = 6;
function donutSlices(cats) {
  const slice = ([id, e], i) => ({ label: catById(id).name, icon: catById(id).icon, value: e.sum, color: id === 'khac' ? 'other' : String(i) });
  if (cats.length <= DONUT_MAX) {
    let k = 0;
    return cats.map(([id, e]) => slice([id, e], id === 'khac' ? 0 : k++));
  }
  const top = cats.filter(([id]) => id !== 'khac').slice(0, DONUT_MAX - 1);
  const rest = cats.filter(x => !top.includes(x));
  return [...top.map(slice), {
    label: 'Khác', icon: '📦', value: rest.reduce((t, [, e]) => t + e.sum, 0), color: 'other', note: `${rest.length} mục`,
  }];
}

function renderStats() {
  renderMonthNavs();
  const ym = state.month;
  const t = today();
  const isCurrent = ym === monthOf(t);
  const monthTx = state.txs.filter(x => monthOf(x.date) === ym);
  const exp = monthTx.filter(x => x.type === 'expense');
  const spent = spentOf(exp);
  const earned = sum(monthTx.filter(x => x.type === 'income'));
  const body = $('#stats-body');

  if (!monthTx.length) {
    body.innerHTML = `<p class="empty card">Chưa có khoản nào trong ${monthLabel(ym).toLowerCase()}.</p>`;
    return;
  }

  const nDays = isCurrent ? Number(t.slice(8)) : daysInMonth(ym);
  // So với cùng kỳ tháng trước (tháng hiện tại chỉ so tới cùng ngày)
  const prevYm = shiftMonth(ym, -1);
  const prevSpent = spentOf(state.txs.filter(x => x.type === 'expense' && monthOf(x.date) === prevYm
    && (!isCurrent || Number(x.date.slice(8)) <= nDays)));
  let delta = '';
  if (prevSpent > 0) {
    const pct = Math.round(((spent - prevSpent) / prevSpent) * 100);
    const up = pct > 0;
    delta = `<span class="kpi-delta ${pct === 0 ? '' : up ? 'bad' : 'good'}">${pct === 0 ? '＝' : up ? '▲' : '▼'} ${Math.abs(pct)}%
      ${up ? 'nhiều hơn' : pct < 0 ? 'ít hơn' : 'bằng'} ${isCurrent ? 'cùng kỳ tháng trước' : 'tháng trước'} (${fmtCompact(prevSpent)})</span>`;
  }

  // Hoá đơn đã chia: mỗi món tính vào danh mục riêng, phần còn lại vào danh mục của hoá đơn
  const parts = exp.flatMap(partsOf);
  const byCat = new Map();
  for (const x of parts) {
    const e = byCat.get(x.category) ?? { sum: 0, count: 0 };
    e.sum += x.amount; e.count += 1;
    byCat.set(x.category, e);
  }
  const cats = [...byCat].sort((a, b) => b[1].sum - a[1].sum);
  const maxCat = cats[0]?.[1].sum || 1;

  const freq = new Map();
  for (const x of parts) {
    const k = normalize(x.name);
    const e = freq.get(k) ?? { name: x.name, sum: 0, count: 0 };
    e.sum += x.amount; e.count += 1;
    freq.set(k, e);
  }
  const frequent = [...freq.values()].filter(e => e.count > 1).sort((a, b) => b.count - a.count || b.sum - a.sum).slice(0, 5);
  const biggest = [...exp].sort((a, b) => netAmount(b) - netAmount(a)).slice(0, 5);
  const balance = earned - spent;
  // Đã tính sẵn vào "Đã chi": phần bạn bè trả lại (trừ ra) và phần được giảm giá (không bao giờ trả)
  const refundedMonth = exp.reduce((s, x) => s + refundedOf(x), 0);
  const saved = savings(exp);
  const extraKpi = [refundedMonth ? `↩️ Được trả lại ${fmtCompact(refundedMonth)}` : '',
    saved.total ? `🏷️ Tiết kiệm nhờ giảm giá ${fmtCompact(saved.total)} (${saved.count} lần)` : ''].filter(Boolean).join(' · ');

  body.innerHTML = `
    <div class="kpis">
      <div class="kpi hero">
        <img class="duck-peek" src="icons/duck-peek.svg" alt="" width="96" height="67">
        <span class="kpi-label">Đã chi ${isCurrent ? 'tháng này' : monthLabel(ym).toLowerCase()}</span>
        <span class="kpi-value">${fmtVND(spent)}</span>
        ${delta}
        <span class="kpi-sub">Trung bình ${fmtVND(spent / nDays)}/ngày · ${exp.length} khoản</span>
        ${extraKpi ? `<span class="kpi-sub">${esc(extraKpi)}</span>` : ''}
      </div>
      <div class="kpi"><span class="kpi-label">Thu nhập</span><span class="kpi-value">${earned ? fmtVND(earned) : '—'}</span></div>
      <div class="kpi"><span class="kpi-label">Còn lại</span><span class="kpi-value">${earned ? `${balance < 0 ? '−' : ''}${fmtVND(Math.abs(balance))}` : '—'}</span></div>
    </div>

    <section class="card">
      <h2 class="card-title"><span>Chi theo danh mục</span>
        <span class="seg" role="group" aria-label="Kiểu xem">
          <button type="button" data-cat-tab="donut" aria-pressed="${state.catTab === 'donut'}">Tỉ lệ</button>
          <button type="button" data-cat-tab="list" aria-pressed="${state.catTab === 'list'}">Danh mục</button>
        </span></h2>
      <div id="donut-chart" class="donut"${state.catTab === 'donut' ? '' : ' hidden'}></div>
      ${cats.length ? `<ul class="cat-bars"${state.catTab === 'list' ? '' : ' hidden'}>${cats.map(([id, e]) => {
        const c = catById(id);
        return `<li><button type="button" class="cat-bar-row tint-${c.tint}" data-goto-cat="${esc(id)}" title="Xem ${e.count} khoản">
          <span class="cat-tile" aria-hidden="true">${esc(c.icon)}</span>
          <span class="cb-label">${esc(c.name)}</span>
          <span class="cb-value">${fmtVND(e.sum)} <small>${Math.round((e.sum / spent) * 100)}%</small></span>
          <span class="cb-track"><span class="cb-fill" data-w="${Math.max(1, (e.sum / maxCat) * 100)}"></span></span>
        </button></li>`;
      }).join('')}</ul>` : `<p class="muted"${state.catTab === 'list' ? '' : ' hidden'}>Chưa có khoản chi.</p>`}
    </section>

    <section class="card">
      <h2 class="card-title"><span>Chi theo ngày</span>
        <span class="seg" role="group" aria-label="Phạm vi">
          <button type="button" data-daily="daily" aria-pressed="${!state.dailyAll}">Hằng ngày</button>
          <button type="button" data-daily="all" aria-pressed="${state.dailyAll}">Tất cả</button>
        </span></h2>
      ${state.dailyAll ? '' : '<p class="muted chart-note">Không tính nhà ở, hóa đơn &amp; khoản cố định</p>'}
      <div id="daily-chart" class="chart"></div>
    </section>

    <div class="grid-2">
      <section class="card">
        <h2 class="card-title">Khoản chi lớn nhất</h2>
        <ul class="tx-list">${biggest.map(x => txItem(x, { showDate: true })).join('') || '<li class="empty">—</li>'}</ul>
      </section>
      <section class="card">
        <h2 class="card-title">Mua thường xuyên</h2>
        ${frequent.length ? `<ol class="rank-list">${frequent.map(e => `<li>
          <span class="tx-name">${esc(e.name)}</span>
          <span class="muted">${e.count} lần</span>
          <b>${fmtVND(e.sum)}</b></li>`).join('')}</ol>` : '<p class="muted">Chưa có khoản nào lặp lại.</p>'}
      </section>
    </div>`;
  // Đặt độ rộng qua CSSOM (CSP chặn thuộc tính style viết trong HTML)
  $$('.cb-fill', body).forEach(el => { el.style.width = `${el.dataset.w}%`; });

  const dim = daysInMonth(ym);
  const dailyParts = exp.flatMap(x => partsOf(x).map(p => ({ ...p, date: x.date, id: x.id, recurring: !!x.recurringId })))
    .filter(p => state.dailyAll || (!FIXED_CATEGORIES.has(p.category) && !p.recurring));
  const daily = Array.from({ length: dim }, (_, i) => {
    const iso = `${ym}-${String(i + 1).padStart(2, '0')}`;
    const items = dailyParts.filter(x => x.date === iso);
    return { label: String(i + 1), title: dayLabel(iso), value: sum(items), count: new Set(items.map(x => x.id)).size, isToday: iso === t };
  });
  renderDailyColumns($('#daily-chart'), daily);
  if (cats.length) renderDonut($('#donut-chart'), donutSlices(cats), spent);
}

// ---------- Sửa / xoá ----------

// Các món của hoá đơn đang sửa — chỉ ghi xuống khi bấm Lưu
let editSplits = [];
let splitRec = null;

const editForm = () => $('#edit-form');
const editTotal = () => parseAmountInput(editForm().elements.amount.value, { slang: state.settings.slang }) ?? 0;
const editParent = () => catById(editForm().elements.category.value);

function renderSplits() {
  const type = editParent().type;
  $('#split-list').innerHTML = editSplits.map((s, i) => {
    const c = catById(s.category);
    return `<li class="split-item tint-${c.tint}" data-i="${i}">
      <span class="tx-icon" aria-hidden="true">${esc(c.icon)}</span>
      <input data-sf="name" value="${esc(s.name)}" placeholder="Tên món" aria-label="Tên món">
      <span class="amount-field"><input data-sf="amount" value="${s.amount ? fmtNum(s.amount) : ''}" placeholder="Giá" aria-label="Giá món" autocomplete="off"><span>đ</span><button type="button" class="calc-btn" data-calc aria-label="Mở máy tính">🧮</button></span>
      <select data-sf="category" aria-label="Danh mục của món">${categoryOptions(s.category, type)}</select>
      <button type="button" class="icon-btn split-del" data-i="${i}" aria-label="Bỏ món này">✕</button>
    </li>`;
  }).join('');
  renderSplitRest();
}

function renderSplitRest() {
  const el = $('#split-rest');
  el.className = 'split-rest';
  if (!editSplits.length) {
    el.innerHTML = '<span class="muted">Chưa chia. Ví dụ hoá đơn siêu thị 100k → nói <q>bánh 25 nước ngọt 25 rau 25</q>.</span>';
    return;
  }
  const used = sum(editSplits.filter(s => s.amount > 0));
  const rest = editTotal() - used;
  if (rest > 0) {
    el.innerHTML = `Còn lại <b>${fmtVND(rest)}</b> → tính vào ${esc(editParent().icon)} ${esc(editParent().name)}`;
  } else if (rest === 0) {
    el.classList.add('done');
    el.textContent = '✓ Đã chia hết';
  } else {
    el.classList.add('over');
    el.innerHTML = `Các món vượt tổng ${fmtVND(-rest)} <button type="button" class="btn" data-fix-total="${used}">Đặt tổng = ${fmtVND(used)}</button>`;
  }
}

/** Thêm món từ câu nói/gõ, ví dụ "bánh 25 nước ngọt 25 rau 25". */
function addSplits(alts) {
  const status = $('#split-status');
  const parsed = alts.map(t => parseUtterance(t, { slang: state.settings.slang })).find(r => r.items.length);
  if (!parsed) {
    status.hidden = false;
    status.textContent = 'Chưa nghe ra giá. Đọc kiểu: bánh 25 nước ngọt 25.';
    return false;
  }
  const parent = editParent();
  for (const it of parsed.items) {
    // Món không đoán được danh mục thì để chung danh mục với hoá đơn
    let c = classify(it.name, state.categories, state.learned);
    if (!c || catById(c).type !== parent.type) c = parent.id;
    editSplits.push({ id: crypto.randomUUID(), name: capitalize(it.name) || `Món ${editSplits.length + 1}`, amount: it.amount, category: c });
  }
  status.hidden = true;
  renderSplits();
  return true;
}

// ----- Chi hộ · được trả lại (trong Sửa khoản) -----
let editOwes = [];
let editRefunds = [];

function renderDebtBox() {
  const expense = editParent().type === 'expense';
  $('#debt-box').hidden = !expense;
  if (!expense) return;
  const amount = editTotal();
  const people = owedOn({ owes: editOwes, refunds: editRefunds });
  const settled = new Set();
  const assetLabel = id => { const a = id && assetById(id); return a ? ` · ${a.icon} ${a.name}` : ''; };
  $('#debt-list').innerHTML = [
    ...editOwes.map((o, i) => {
      const key = personKey(o.person);
      const left = !settled.has(key) && people.get(key)?.left;
      settled.add(key);
      return `<li class="debt-item"><span class="debt-text">🤝 <b>${esc(o.person)}</b> nợ ${fmtVND(o.amount)}</span>
        ${left ? `<button type="button" class="btn chip-btn" data-debt-settle="${esc(key)}">↩️ Trả đủ ${fmtCompact(left)}</button>` : ''}
        <button type="button" class="icon-btn" data-debt-del="owe:${i}" aria-label="Xoá dòng nợ">✕</button></li>`;
    }),
    ...editRefunds.map((r, i) => `<li class="debt-item"><span class="debt-text">↩️ <b>${esc(r.person)}</b> trả ${fmtVND(r.amount)} · ${esc(shortDate(r.date))}${esc(assetLabel(r.assetId))}</span>
      <button type="button" class="icon-btn" data-debt-del="ref:${i}" aria-label="Xoá lần trả">✕</button></li>`),
  ].join('');
  const hasAssets = liveAssets(state.assets).length > 0;
  $('#debt-asset-row').hidden = !hasAssets;
  const refunded = sum(editRefunds);
  const left = [...people.values()].reduce((s, e) => s + e.left, 0);
  const el = $('#debt-sum');
  el.className = `split-rest${refunded > amount ? ' over' : refunded || left ? ' done' : ''}`;
  el.textContent = refunded > amount ? `Trả lại ${fmtVND(refunded)} — nhiều hơn số tiền khoản này`
    : refunded || left ? [refunded ? `Đã được trả ${fmtVND(refunded)} · chi thực ${fmtVND(amount - refunded)}` : '', left ? `còn nợ ${fmtVND(left)}` : ''].filter(Boolean).join(' · ')
      : 'Chi hộ ai thì ghi ở đây — khi họ trả lại, chi thực của bạn giảm theo.';
}

function updateDiscountHint() {
  const f = editForm();
  const paid = editTotal();
  const d = parseDiscountInput(f.elements.discount.value, paid, parseMoney);
  $('#edit-discount-hint').textContent = d == null ? 'Chưa hiểu — ví dụ 50k hoặc 20%'
    : d ? `Giá gốc ${fmtVND(paid + d)} · đã trả ${fmtVND(paid)}` : 'Số tiền ở trên là số đã trả sau khi giảm';
}

function setupDebtBox() {
  const person = $('#debt-person');
  const amount = $('#debt-amount');
  const read = () => {
    const name = person.value.trim();
    const v = parseMoney(amount.value);
    if (!name || !(v > 0)) { toast(!name ? 'Nhập tên người' : 'Nhập số tiền'); return null; }
    person.value = '';
    amount.value = '';
    return { name: displayPerson(name), v };
  };
  $('#debt-owe').addEventListener('click', () => {
    const x = read();
    if (!x) return;
    editOwes.push({ id: crypto.randomUUID(), person: x.name, amount: x.v });
    renderDebtBox();
  });
  const addRefund = (name, v) => editRefunds.push({
    id: crypto.randomUUID(), person: name, amount: v, ...($('#debt-asset').value ? { assetId: $('#debt-asset').value } : {}),
    date: today(), createdAt: new Date().toISOString(),
  });
  $('#debt-paid').addEventListener('click', () => {
    const x = read();
    if (!x) return;
    addRefund(x.name, x.v);
    renderDebtBox();
  });
  $('#debt-list').addEventListener('click', e => {
    const del = e.target.closest('[data-debt-del]');
    if (del) {
      const [kind, i] = del.dataset.debtDel.split(':');
      (kind === 'owe' ? editOwes : editRefunds).splice(Number(i), 1);
      return renderDebtBox();
    }
    const settle = e.target.closest('[data-debt-settle]');
    if (settle) {
      const e2 = owedOn({ owes: editOwes, refunds: editRefunds }).get(settle.dataset.debtSettle);
      if (e2?.left) addRefund(e2.name, e2.left);
      renderDebtBox();
    }
  });
  // Enter trong ô người / số tiền không bấm "Lưu" của cả hộp thoại
  [person, amount].forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') e.preventDefault(); }));
  editForm().elements.discount.addEventListener('input', updateDiscountHint);
}

function setupEditDialog() {
  const dlg = $('#edit-dialog');
  const f = editForm();
  setupDebtBox();
  f.addEventListener('submit', async e => {
    if (e.submitter?.value !== 'save') return;
    const amount = editTotal();
    if (!amount) {
      e.preventDefault();
      f.elements.amount.setCustomValidity('Số tiền chưa hợp lệ');
      f.elements.amount.reportValidity();
      return;
    }
    const splits = editSplits.filter(s => s.name.trim() || s.amount > 0);
    if (splits.some(s => !(s.amount > 0))) {
      e.preventDefault();
      return toast('Có món chưa có giá');
    }
    if (sum(splits) > amount) {
      e.preventDefault();
      renderSplitRest();
      return toast('Các món cộng lại vượt tổng tiền');
    }
    const discount = parseDiscountInput(f.elements.discount.value, amount, parseMoney);
    if (discount == null) {
      e.preventDefault();
      return toast('Số tiền được giảm chưa đúng — ví dụ 50k hoặc 20%');
    }
    if (sum(editRefunds) > amount) {
      e.preventDefault();
      return toast('Tiền được trả lại nhiều hơn số tiền khoản này');
    }
    const t = state.txs.find(x => x.id === f.dataset.id);
    if (!t || !store.unlocked) return;
    const cat = editParent();
    const clean = splits.map(s => ({
      id: s.id, name: capitalize(s.name.trim()) || 'Món', amount: s.amount,
      category: catById(s.category).type === cat.type ? catById(s.category).id : cat.id,
    }));
    Object.assign(t, {
      name: capitalize(f.elements.name.value.trim()), amount, category: cat.id, type: cat.type,
      date: f.elements.date.value, updatedAt: new Date().toISOString(),
    });
    if (clean.length) t.splits = clean;
    else delete t.splits;
    if (f.elements.assetId.value) t.assetId = f.elements.assetId.value;
    else delete t.assetId;
    // Giảm giá, ai nợ, ai trả lại: chỉ có ở khoản chi
    const expense = cat.type === 'expense';
    const setList = (key, list) => { if (expense && list.length) t[key] = list.map(x => ({ ...x })); else delete t[key]; };
    setList('owes', editOwes);
    setList('refunds', editRefunds);
    if (expense && discount) t.discount = discount;
    else delete t.discount;
    await store.putTx([t]);
    await learnFrom([t, ...clean.map(s => ({ name: s.name, category: s.category, type: cat.type }))]);
    renderTopbar();
    renderView(state.view);
    toast(clean.length ? `Đã lưu, chia ${clean.length} món` : 'Đã cập nhật');
  });
  f.elements.amount.addEventListener('input', () => {
    f.elements.amount.setCustomValidity('');
    renderSplitRest();
    renderDebtBox();
    updateDiscountHint();
  });
  f.elements.category.addEventListener('change', () => {
    $('#edit-discount-row').hidden = editParent().type !== 'expense';
    renderDebtBox();
    // Đổi giữa Chi/Thu: món khác loại chuyển theo danh mục của hoá đơn
    const parent = editParent();
    editSplits.forEach(s => { if (catById(s.category).type !== parent.type) s.category = parent.id; });
    renderSplits();
  });
  $('#edit-delete').addEventListener('click', async () => {
    if (!confirm('Xoá khoản này?')) return;
    dlg.close();
    await removeTx([f.dataset.id]);
  });

  // ----- Chia nhỏ hoá đơn -----
  const input = $('#split-input');
  const status = $('#split-status');
  const addFromInput = () => { if (input.value.trim() && addSplits([input.value.trim()])) input.value = ''; };
  $('#split-add-btn').addEventListener('click', addFromInput);
  input.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault(); // Enter trong form sẽ bấm "Lưu"
    addFromInput();
  });

  const list = $('#split-list');
  const onSplitEdit = e => {
    const row = e.target.closest('.split-item');
    const field = e.target.dataset.sf;
    if (!row || !field) return;
    const s = editSplits[Number(row.dataset.i)];
    if (field === 'amount') {
      s.amount = parseAmountInput(e.target.value, { slang: state.settings.slang }) ?? 0;
      if (e.type === 'change' && s.amount) e.target.value = fmtNum(s.amount);
      renderSplitRest();
    } else if (field === 'category') {
      s.category = e.target.value;
      if (e.type === 'change') renderSplits();
    } else {
      s.name = e.target.value;
    }
  };
  list.addEventListener('input', onSplitEdit);
  list.addEventListener('change', onSplitEdit);
  list.addEventListener('click', e => {
    const del = e.target.closest('.split-del');
    if (!del) return;
    editSplits.splice(Number(del.dataset.i), 1);
    renderSplits();
  });
  $('#split-rest').addEventListener('click', e => {
    const fix = e.target.closest('[data-fix-total]');
    if (!fix) return;
    f.elements.amount.value = fmtNum(Number(fix.dataset.fixTotal));
    renderSplitRest();
  });

  const mic = $('#split-mic');
  splitRec = createRecognizer({
    onInterim: t => { status.hidden = false; status.textContent = `“${t}”`; },
    onFinal: alts => addSplits(alts),
    onError: err => {
      if (VOICE_ERRORS[err] === '') return;
      status.hidden = false;
      status.textContent = VOICE_ERRORS[err] ?? `Lỗi nhận giọng nói: ${err}`;
    },
    onEnd: () => mic.classList.remove('listening'),
  });
  if (!splitRec) mic.hidden = true;
  mic.addEventListener('click', () => {
    if (splitRec.listening) return splitRec.stop();
    try {
      splitRec.start();
      mic.classList.add('listening');
      status.hidden = false;
      status.textContent = 'Đang nghe… đọc các món kèm giá';
    } catch {
      status.textContent = 'Không mở được micro, thử lại nhé.';
    }
  });
  dlg.addEventListener('close', () => { if (splitRec?.listening) splitRec.stop(); });
}

function openEdit(id) {
  const t = state.txs.find(x => x.id === id);
  if (!t) return;
  const f = editForm();
  f.dataset.id = id;
  f.elements.name.value = t.name;
  f.elements.amount.value = fmtNum(t.amount);
  f.elements.category.innerHTML = categoryOptions(t.category);
  f.elements.date.value = t.date;
  f.elements.assetId.innerHTML = assetOptions(t.assetId ?? '');
  $('#edit-asset-row').hidden = !liveAssets(state.assets).length && !t.assetId;
  $('#edit-raw').textContent = t.raw ? `Câu gốc: “${t.raw}”` : '';
  editSplits = (t.splits ?? []).map(s => ({ ...s }));
  editOwes = (t.owes ?? []).map(o => ({ ...o }));
  editRefunds = (t.refunds ?? []).map(r => ({ ...r }));
  f.elements.discount.value = t.discount ? fmtNum(t.discount) : '';
  $('#edit-discount-row').hidden = t.type !== 'expense';
  $('#debt-person').value = '';
  $('#debt-amount').value = '';
  $('#debt-asset').innerHTML = assetOptions(defaultAsset(state.assets)?.id ?? '', 'Không tính vào tài sản');
  updateDiscountHint();
  renderDebtBox();
  $('#split-input').value = '';
  $('#split-status').hidden = true;
  renderSplits();
  $('#edit-dialog').showModal();
}

// ---------- Cài đặt ----------

async function saveCustom() {
  state.categories = buildCategories(state.custom);
  state.customUpdatedAt = new Date().toISOString();
  await saveProfile();
}

const saveSettings = () => db.set('settings', state.settings);

function setupSettings() {
  for (const [id, key] of [['#set-slang', 'slang'], ['#set-autosave', 'autoSave']]) {
    $(id).addEventListener('change', async e => {
      state.settings[key] = e.target.checked;
      await saveSettings();
    });
  }
  $('#set-lockafter').addEventListener('change', async e => {
    state.settings.lockAfter = Number(e.target.value);
    await saveSettings();
  });
  $('#lock-now').addEventListener('click', lockNow);

  const cs = $('#cat-settings');
  cs.addEventListener('click', e => {
    const add = e.target.closest('[data-kw-add]');
    if (add) return addKeywords(add.dataset.kwAdd);
    const del = e.target.closest('[data-kw-del]');
    if (del) removeKeyword(del.dataset.kwDel, del.dataset.kw);
  });
  cs.addEventListener('keydown', e => {
    const input = e.target.closest('[data-kw-input]');
    if (input && e.key === 'Enter') {
      e.preventDefault();
      addKeywords(input.dataset.kwInput);
    }
  });

  $('#cat-add').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const name = f.elements.name.value.trim();
    if (!name) return;
    state.custom.added = [...(state.custom.added ?? []), {
      id: `c-${Date.now().toString(36)}`, name, icon: f.elements.icon.value.trim() || '🏷️', type: f.elements.type.value, keywords: [name],
    }];
    await saveCustom();
    f.reset();
    renderSettings();
    toast(`Đã thêm danh mục “${name}”`);
  });

  $('#learned-list').addEventListener('click', async e => {
    const b = e.target.closest('[data-unlearn]');
    if (!b) return;
    delete state.learned[b.dataset.unlearn];
    await saveProfile();
    renderSettings();
  });

  setupRecurring();
  $('#sync-now').addEventListener('click', () => syncNow());
  $('#set-autosync').addEventListener('change', async e => {
    state.settings.autoSync = e.target.checked;
    await saveSettings();
  });
  $('#sync-disconnect').addEventListener('click', async () => {
    if (!confirm('Ngắt kết nối Google Drive trên máy này? Dữ liệu (đã mã hoá) trên Drive vẫn còn.')) return;
    gdrive.forgetToken({ revoke: true });
    delete state.meta.googleEmail;
    delete state.meta.lastSync;
    state.settings.googleConnected = false;
    await Promise.all([saveSettings(), saveProfile()]);
    renderSyncCard();
    toast('Đã ngắt kết nối Google Drive');
  });

  $('#export-json').addEventListener('click', exportBackup);
  $('#export-csv').addEventListener('click', exportCsv);
  $('#import-json').addEventListener('click', () => { keepUnlockedUntil = Date.now() + 120_000; });
  $('#import-json').addEventListener('change', importBackup);
  $('#wipe').addEventListener('click', () => wipeEverything(
    `Xoá toàn bộ ${state.txs.length} khoản, danh mục tự thêm, phần đã học và mật khẩu?\nKhông thể hoàn tác — nên bấm “Sao lưu” trước.`,
  ));
}

function kwChips(id) {
  const words = state.custom.extraKeywords?.[id] ?? [];
  return words.length
    ? words.map(w => `<button type="button" class="kw-chip" data-kw-del="${esc(id)}" data-kw="${esc(w)}" aria-label="Xoá từ khoá ${esc(w)}">${esc(w)}<span aria-hidden="true">✕</span></button>`).join('')
    : '<span class="muted">Chưa có từ khoá riêng.</span>';
}

function refreshKeywords(id) {
  const set = [...$$('[data-cat-set]')].find(d => d.dataset.catSet === id);
  if (!set) return;
  const c = catById(id);
  set.querySelector('.kw-chips').innerHTML = kwChips(id);
  set.querySelector('.kw-count').textContent = `· ${c.type === 'income' ? 'thu' : 'chi'} · ${c.kw.length} từ khoá`;
}

async function addKeywords(id) {
  const input = [...$$('[data-kw-input]')].find(i => i.dataset.kwInput === id);
  const words = (input?.value ?? '').split(/[,\n]/).map(w => w.trim()).filter(Boolean);
  if (!words.length) {
    input?.focus();
    return toast('Gõ từ khoá trước rồi bấm Lưu');
  }
  const known = new Set(catById(id).kw.map(x => x.k));
  const fresh = [...new Set(words.filter(w => !known.has(normalize(w))))];
  if (!fresh.length) return toast('Từ khoá này đã có trong danh mục');
  state.custom.extraKeywords = { ...state.custom.extraKeywords, [id]: [...(state.custom.extraKeywords?.[id] ?? []), ...fresh] };
  await saveCustom();
  input.value = '';
  refreshKeywords(id);
  toast(`Đã lưu ${fresh.map(w => `“${w}”`).join(', ')} cho ${catById(id).name}`);
}

async function removeKeyword(id, word) {
  state.custom.extraKeywords = { ...state.custom.extraKeywords, [id]: (state.custom.extraKeywords?.[id] ?? []).filter(w => w !== word) };
  await saveCustom();
  refreshKeywords(id);
  toast(`Đã xoá “${word}”`);
}

async function renderSettings() {
  renderSyncCard();
  renderRecurring();
  if (state.settings.googleConnected) gdrive.preload();
  $('#set-slang').checked = state.settings.slang;
  $('#set-autosave').checked = state.settings.autoSave;
  $('#set-lockafter').value = String(state.settings.lockAfter);

  $('#cat-settings').innerHTML = state.categories.map(c => `
    <details class="cat-set" data-cat-set="${esc(c.id)}">
      <summary><span aria-hidden="true">${esc(c.icon)}</span> ${esc(c.name)} <span class="muted kw-count">· ${c.type === 'income' ? 'thu' : 'chi'} · ${c.kw.length} từ khoá</span></summary>
      <p class="kw-label">Từ khoá của bạn <span class="muted">(ưu tiên hơn từ có sẵn)</span></p>
      <div class="kw-chips">${kwChips(c.id)}</div>
      <div class="kw-add">
        <input type="text" data-kw-input="${esc(c.id)}" enterkeyhint="done" autocomplete="off" placeholder="Ví dụ: bánh flan, sữa đặc" aria-label="Thêm từ khoá cho ${esc(c.name)}">
        <button type="button" class="btn primary" data-kw-add="${esc(c.id)}">Lưu</button>
      </div>
      ${c.keywords?.length ? `<p class="muted kw-default"><b>Có sẵn:</b> ${esc(c.keywords.join(', '))}</p>` : ''}
    </details>`).join('');

  const learned = Object.entries(state.learned).sort((a, b) => a[0].localeCompare(b[0], 'vi'));
  $('#learned-list').innerHTML = learned.length ? learned.map(([k, id]) => {
    const c = catById(id);
    return `<li><span>${esc(k)}</span><span class="muted">→ ${esc(c.icon)} ${esc(c.name)}</span>
      <button type="button" class="icon-btn" data-unlearn="${esc(k)}" aria-label="Quên">✕</button></li>`;
  }).join('') : '<li class="empty">Chưa có. Khi bạn đổi danh mục của một khoản, app sẽ nhớ ở đây.</li>';

  const persisted = await navigator.storage?.persisted?.();
  // Đồng bộ Google Drive cũng là một bản sao lưu
  const [last, via] = [[state.meta.lastBackup, 'file'], [state.meta.lastSync, 'Google Drive']]
    .filter(([t]) => t).sort((x, y) => Date.parse(y[0]) - Date.parse(x[0]))[0] ?? [];
  $('#data-info').innerHTML = `${state.txs.length} khoản, mã hoá và lưu ngay trên máy này${persisted ? ' (đã khoá chống tự xoá)' : ''}.<br>
    Sao lưu gần nhất: ${last ? `${esc(ago(last))} (${via})` : '<b>chưa sao lưu</b>'}.`;
}

function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportBackup() {
  state.meta.lastBackup = new Date().toISOString();
  await saveProfile();
  download(`coin-manager-${today()}.json`, JSON.stringify(await store.exportBackup()), 'application/json');
  renderSettings();
}

function exportCsv() {
  if (!confirm('File CSV KHÔNG được mã hoá — ai có file cũng đọc được. Vẫn xuất?')) return;
  // Chặn công thức Excel trong tên (=, +, -, @)
  const q = v => `"${String(v ?? '').replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"`;
  // Mỗi món của hoá đơn đã chia là một dòng, cột "Hoá đơn" cho biết thuộc khoản nào.
  // Số tiền = chi thực (đã trừ phần bạn bè trả lại); cột "Hoàn / nợ" ghi ai trả, ai còn nợ (ở dòng đầu của khoản)
  const debtText = t => [...owedOn(t).values()].flatMap(e => [e.paid ? `${e.name} trả ${e.paid}` : '', e.left ? `${e.name} còn nợ ${e.left}` : ''])
    .filter(Boolean).join('; ');
  const rows = [...state.txs].sort((a, b) => a.date.localeCompare(b.date)).flatMap(t => partsOf(t).map((p, i) => [
    t.date, q(t.name), q(p.name), t.type === 'income' ? p.amount : -p.amount, t.type === 'income' ? 'Thu' : 'Chi',
    q(catById(p.category).name), q(t.assetId ? (assetById(t.assetId)?.name ?? '') : ''), q(i === 0 ? debtText(t) : ''), q(t.raw),
  ].join(',')));
  download(`coin-manager-${today()}.csv`, `﻿Ngày,Hoá đơn,Món,Số tiền,Loại,Danh mục,Tài sản,Hoàn / nợ,Câu nói\n${rows.join('\n')}`, 'text/csv');
}

const isValidOwe = o => o && typeof o.person === 'string' && !!o.person.trim() && Number.isFinite(o.amount) && o.amount > 0;
const isValidRefund = r => isValidOwe(r) && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && (r.assetId === undefined || typeof r.assetId === 'string');
const isValidSplit = s => s && typeof s.name === 'string' && Number.isFinite(s.amount) && s.amount > 0 && typeof s.category === 'string';
const isValidTx = t => t && typeof t.id === 'string' && typeof t.name === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.date)
  && Number.isFinite(t.amount) && t.amount > 0 && (t.type === 'income' || t.type === 'expense') && typeof t.category === 'string'
  && (t.splits === undefined || (Array.isArray(t.splits) && t.splits.every(isValidSplit) && sum(t.splits) <= t.amount))
  && (t.assetId === undefined || typeof t.assetId === 'string')
  && (t.discount === undefined || (Number.isFinite(t.discount) && t.discount > 0))
  && (t.owes === undefined || (Array.isArray(t.owes) && t.owes.every(isValidOwe)))
  && (t.refunds === undefined || (Array.isArray(t.refunds) && t.refunds.every(isValidRefund) && sum(t.refunds) <= t.amount));

async function readFileJson(input) {
  const file = input.files[0];
  input.value = '';
  if (!file) return null;
  try {
    return JSON.parse(await file.text());
  } catch {
    toast('File không đọc được');
    return null;
  }
}

// Máy mới (chưa có mật khẩu): dùng luôn kho khoá trong bản sao lưu
async function restoreOnNewDevice(e) {
  const data = await readFileJson(e.target);
  if (!data) return;
  if (!store.isBackup(data)) return toast('Không phải bản sao lưu đã mã hoá của Coin Manager');
  const n = data.tx.length + (data.inbox?.length ?? 0);
  if (!confirm(`Khôi phục ${n} khoản? Sau đó mở khoá bằng mật khẩu bạn dùng lúc sao lưu.`)) return;
  await store.restoreFresh(data);
  renderTopbar();
  showView('record', { gate: true });
}

async function importBackup(e) {
  const data = await readFileJson(e.target);
  if (!data || !store.unlocked) return;
  let result;
  if (store.isBackup(data)) {
    result = store.needsPassphraseFor(data)
      ? await askPassphrase('File này được tạo với mật khẩu khác. Nhập mật khẩu lúc sao lưu để mở.', pass => store.readBackup(data, pass))
      : await store.readBackup(data).catch(() => null);
    if (!result) return;
  } else if (Array.isArray(data?.transactions)) {
    // Bản sao lưu cũ chưa mã hoá
    result = { txs: data.transactions, failed: 0, profile: { learned: data.learned, custom: data.custom } };
  } else {
    return toast('File không phải bản sao lưu của Coin Manager');
  }

  const usable = result.txs.filter(t => isValidTx(t) || isTomb(t));
  resolveInboxAssets(usable.filter(t => !isTomb(t)));
  const incoming = usable.map(t => (isTomb(t) ? t : finalizeInboxItem(t)));
  if (!confirm(`Gộp ${incoming.length} khoản từ file? Cùng một khoản thì giữ bản sửa sau cùng.`)) return;
  const { rows, pulledIds } = mergeRows([...state.txs, ...state.tombs], incoming);
  await store.putTx(rows.filter(r => pulledIds.has(r.id)));
  state.txs = rows.filter(r => !isTomb(r));
  state.tombs = rows.filter(isTomb);
  applyProfile(mergeProfile(profileNow(), result.profile ?? {}));
  await saveProfile();
  renderAll();
  toast(`Đã gộp ${pulledIds.size} thay đổi từ file${result.failed ? ` (${result.failed} khoản lỗi)` : ''}`);
}

// ---------- Ví: chia tiền kiểu "chia hũ" (ăn uống, tiết kiệm, học phí…) ----------
// Ví + các lần nạp nằm trong hồ sơ đã mã hoá. Khoản chi tự trừ vào ví theo danh mục (xem js/wallets.js).

const CALC_BTN = '<button type="button" class="calc-btn" data-calc aria-label="Mở máy tính">🧮</button>';
const incomeTxs = () => state.txs.filter(t => t.type === 'income');
const expenseParts = txs => txs.filter(t => t.type === 'expense').flatMap(t => partsOf(t).map(p => ({ ...p, date: t.date })));
const walletStats = () => walletBalances(state.wallets, state.allocs, expenseParts(state.txs), today());
const walletById = id => liveWallets(state.wallets).find(w => w.id === id);
const parseMoney = s => parseAmountInput(s, { slang: state.settings.slang });
const signedCompact = n => `${n < 0 ? '−' : ''}${fmtCompact(Math.abs(n))}`;

function renderWallets() {
  $('#wallet-card').hidden = !store.unlocked;
  if (!store.unlocked) return;
  const ws = liveWallets(state.wallets);
  // "+ Thêm ví" nằm ở hàng nút (luôn thấy) — để cuối hàng ô cuộn ngang thì có nhiều ví sẽ bị đẩy khuất
  $('#wallet-actions').hidden = !ws.length;
  $('#wallet-move').hidden = ws.length < 2;
  const { free } = unallocated(incomeTxs(), state.allocs, state.wallets, monthOf(today()));
  $('#wallet-free').textContent = ws.length && free ? `💸 ${fmtCompact(free)} chưa chia` : '';
  if (!ws.length) {
    $('#wallet-strip').innerHTML = `<div class="wallet-empty">
      <p class="muted">Chia thu nhập vào các ví nhỏ — ăn uống, tiết kiệm, học phí… Khoản chi tự trừ vào ví theo danh mục, nhìn là biết mỗi ví còn bao nhiêu.</p>
      <div class="btn-row"><button type="button" class="btn primary" data-wallet-jars>🫙 Dùng mẫu 6 hũ</button><button type="button" class="btn" data-wallet-new>+ Tự tạo ví</button></div>
    </div>`;
    return;
  }
  const stats = walletStats();
  $('#wallet-strip').innerHTML = ws.map(w => {
    const s = stats.get(w.id);
    const saving = isSaving(w);
    const used = s.balance < 0 ? 100 : s.available > 0 ? Math.min(100, (s.monthSpent / s.available) * 100) : 0;
    const sub = saving ? (s.monthIn ? `+${fmtCompact(s.monthIn)} tháng này` : 'để dành')
      : s.balance < 0 ? 'chi quá' : `còn · chi ${s.monthSpent ? fmtCompact(s.monthSpent) : '0'}`;
    return `<button type="button" class="wallet-tile tint-${w.tint}${s.balance < 0 ? ' over' : ''}" data-wallet="${esc(w.id)}">
      <span class="wt-head"><span class="wt-icon" aria-hidden="true">${esc(w.icon)}</span><span class="wt-name">${esc(w.name)}</span></span>
      <b class="wt-bal">${signedCompact(s.balance)}</b>
      <span class="wt-sub">${esc(sub)}</span>
      ${saving ? '' : `<span class="wt-track"><span class="wt-fill" data-w="${used.toFixed(1)}"></span></span>`}
    </button>`;
  }).join('');
  $$('#wallet-strip .wt-fill').forEach(el => { el.style.width = `${el.dataset.w}%`; });
}

/** "🍜 Ăn uống còn 1,2tr" cho các ví bị trừ bởi những khoản vừa lưu. */
function walletNote(txs) {
  const ws = liveWallets(state.wallets);
  if (!ws.length) return '';
  const hit = [...new Set(expenseParts(txs).map(p => {
    const w = walletForCategory(p.category, ws);
    return w && p.date >= (w.since ?? '') ? w.id : null;
  }).filter(Boolean))].slice(0, 2);
  if (!hit.length) return '';
  const stats = walletStats();
  return ' · ' + hit.map(id => {
    const w = walletById(id);
    const b = stats.get(id).balance;
    return `${w.icon} ${w.name} ${b < 0 ? `âm ${fmtCompact(-b)}` : `còn ${fmtCompact(b)}`}`;
  }).join(', ');
}

async function useJars() {
  if (!store.unlocked) return;
  const now = new Date().toISOString();
  const since = monthStart(today());
  const known = new Set(state.categories.map(c => c.id));
  let ws = state.wallets;
  for (const j of JARS) {
    ws = upsertWallet(ws, {
      id: crypto.randomUUID(), name: j.name, icon: j.icon, tint: nextTint(ws), share: { pct: j.pct },
      cats: j.cats.filter(c => known.has(c)), catchAll: !!j.catchAll, since, order: nextOrder(ws),
    }, now);
  }
  state.wallets = ws;
  await saveProfile();
  renderWallets();
  toast('Đã tạo 6 hũ (55/10/10/10/10/5%). Có lương thì bấm “Chia tiền” nhé!');
}

let walletEditing = null;
let walletCats = new Set();

function renderWalletCats() {
  const owner = new Map();
  for (const w of liveWallets(state.wallets)) if (w.id !== walletEditing?.id) (w.cats ?? []).forEach(c => owner.set(c, w));
  $('#wallet-cats').innerHTML = state.categories.filter(c => c.type === 'expense').map(c => {
    const on = walletCats.has(c.id);
    const other = !on && owner.get(c.id);
    return `<button type="button" class="cat-toggle tint-${c.tint}" data-wcat="${esc(c.id)}" aria-pressed="${on}">${esc(c.icon)} ${esc(c.name)}${other ? `<small> · ${esc(other.name)}</small>` : ''}</button>`;
  }).join('');
}

function updateShareHint() {
  const f = $('#wallet-form');
  const share = parseShare(f.elements.share.value, parseMoney);
  $('#wallet-share-hint').textContent = share === undefined ? 'Chưa hiểu — ví dụ 30% hoặc 3tr'
    : share?.pct ? `${share.pct}% số tiền mỗi lần chia (sau khi trừ các ví số tiền cố định)`
      : share?.amount ? `${fmtVND(share.amount)} mỗi lần chia` : 'Bỏ trống thì tự nhập lúc chia tiền';
}

function renderWalletDetail(w) {
  const s = walletStats().get(w.id);
  const label = isSaving(w) ? 'Đã để dành' : s.balance < 0 ? 'Chi quá' : 'Còn';
  $('#wallet-stat').innerHTML = `<b class="${s.balance < 0 ? 'bad' : ''}">${label} ${fmtVND(Math.abs(s.balance))}</b>
    <span>Tháng ${Number(today().slice(5, 7))}: nạp ${fmtVND(s.monthIn)} · chi ${fmtVND(s.monthSpent)}</span>`;
  const list = state.allocs.filter(a => !a.deleted && a.wallet === w.id)
    .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt ?? '').localeCompare(a.createdAt ?? '')).slice(0, 12);
  $('#wallet-history').innerHTML = list.length ? list.map(a => {
    const pair = a.kind === 'move' ? state.allocs.find(x => x.group === a.group && x.id !== a.id) : null;
    const otherName = pair ? (walletById(pair.wallet)?.name ?? 'ví đã xoá') : '';
    const what = a.kind === 'move' ? (a.amount < 0 ? `chuyển sang ${otherName}` : `nhận từ ${otherName}`) : 'chia tiền vào ví';
    return `<li><span><b>${a.amount < 0 ? '−' : '+'}${fmtVND(Math.abs(a.amount))}</b><small>${esc(dayLabel(a.date))} · ${esc(what)}</small></span>
      <button type="button" class="icon-btn" data-alloc-del="${esc(a.id)}" aria-label="Xoá lần này">✕</button></li>`;
  }).join('') : '<li class="empty">Chưa nạp lần nào.</li>';
}

function openWallet(id) {
  if (!store.unlocked) return;
  const f = $('#wallet-form');
  const w = id ? walletById(id) : null;
  walletEditing = w;
  f.reset();
  setFormError(f, '');
  $('#wallet-title').textContent = w ? `${w.icon} ${w.name}` : 'Thêm ví';
  $('#wallet-suggest').hidden = !!w;
  $('#wallet-delete').hidden = !w;
  $('#wallet-more').hidden = !w;
  $('#wallet-stat').hidden = !w;
  f.elements.name.value = w?.name ?? '';
  f.elements.icon.value = WALLET_ICONS.includes(w?.icon) ? w.icon : '👛';
  f.elements.share.value = shareText(w?.share, fmtNum);
  f.elements.catchAll.checked = !!w?.catchAll;
  f.elements.since.value = w?.since ?? monthStart(today());
  walletCats = new Set(w?.cats ?? []);
  renderWalletCats();
  updateShareHint();
  if (w) renderWalletDetail(w);
  $('#wallet-dialog').showModal();
}

async function removeAllocs(ids, msg) {
  const now = new Date().toISOString();
  const groups = new Set(state.allocs.filter(a => ids.includes(a.id) && a.kind === 'move').map(a => a.group));
  const gone = state.allocs.filter(a => !a.deleted && (ids.includes(a.id) || (a.kind === 'move' && groups.has(a.group))));
  const goneIds = new Set(gone.map(a => a.id));
  state.allocs = state.allocs.map(a => (goneIds.has(a.id) ? { id: a.id, deleted: true, updatedAt: now } : a));
  await saveProfile();
  refreshWalletViews();
  toast(msg, {
    action: 'Hoàn tác',
    onAction: async () => {
      const t = new Date().toISOString();
      state.allocs = state.allocs.map(a => (goneIds.has(a.id) ? { ...gone.find(g => g.id === a.id), updatedAt: t } : a));
      await saveProfile();
      refreshWalletViews();
    },
  });
}

function refreshWalletViews() {
  renderWallets();
  if ($('#wallet-dialog').open && walletEditing) renderWalletDetail(walletEditing);
}

let allocTouched = false;

function openAlloc(total) {
  const ws = liveWallets(state.wallets);
  if (!store.unlocked) return;
  if (!ws.length) return openWallet();
  const f = $('#alloc-form');
  f.reset();
  setFormError(f, '');
  const ym = monthOf(today());
  const u = unallocated(incomeTxs(), state.allocs, state.wallets, ym);
  $('#alloc-income').textContent = u.income
    ? `Thu tháng ${Number(ym.slice(5))}: ${fmtVND(u.income)} · đã chia ${fmtVND(u.given)}`
    : 'Nhập số tiền muốn chia, ví dụ lương tháng này.';
  const t = total ?? u.free;
  f.elements.total.value = t ? fmtNum(t) : '';
  f.elements.date.value = today();
  const stats = walletStats();
  const noShare = !ws.some(w => w.share);
  $('#alloc-noshare').hidden = !noShare;
  $('#alloc-refill').hidden = noShare;
  $('#alloc-rows').innerHTML = ws.map(w => {
    const sub = [shareText(w.share, fmtCompact), `${isSaving(w) ? 'có' : 'còn'} ${signedCompact(stats.get(w.id).balance)}`].filter(Boolean).join(' · ');
    return `<li class="alloc-row tint-${w.tint}">
      <span class="tx-icon" aria-hidden="true">${esc(w.icon)}</span>
      <span class="tx-main"><span class="tx-name">${esc(w.name)}</span><span class="tx-sub">${esc(sub)}</span></span>
      <span class="amount-field"><input data-alloc="${esc(w.id)}" autocomplete="off" aria-label="Số tiền vào ví ${esc(w.name)}"><span>đ</span>${CALC_BTN}</span>
    </li>`;
  }).join('');
  fillAlloc();
  $('#alloc-dialog').showModal();
}

const allocTotal = () => parseMoney($('#alloc-form').elements.total.value) ?? 0;
const allocRows = () => $$('[data-alloc]').map(i => ({ wallet: i.dataset.alloc, amount: i.value.trim() ? (parseMoney(i.value) ?? NaN) : 0 }));

function fillAlloc() {
  const plan = planSplit(state.wallets, allocTotal());
  $$('[data-alloc]').forEach(i => { const v = plan.get(i.dataset.alloc); i.value = v ? fmtNum(v) : ''; });
  allocTouched = false;
  updateAllocRest();
}

function updateAllocRest() {
  const total = allocTotal();
  const given = allocRows().reduce((s, r) => s + (r.amount || 0), 0);
  const rest = total - given;
  const el = $('#alloc-rest');
  el.className = `split-rest${total && rest < 0 ? ' over' : total && rest === 0 ? ' done' : ''}`;
  el.textContent = !total ? (given ? `Tổng ${fmtVND(given)}` : '')
    : rest > 0 ? `Còn ${fmtVND(rest)} chưa chia — để lại, chia sau cũng được`
      : rest < 0 ? `Vượt ${fmtVND(-rest)} so với số tiền` : '✓ Chia vừa đủ';
}

function openMove(fromId) {
  if (!store.unlocked) return;
  const ws = liveWallets(state.wallets);
  if (ws.length < 2) return toast('Cần ít nhất 2 ví để chuyển tiền');
  const f = $('#move-form');
  f.reset();
  setFormError(f, '');
  const from = walletById(fromId)?.id ?? ws[0].id;
  const to = ws.find(w => w.id !== from).id;
  const opts = sel => ws.map(w => `<option value="${esc(w.id)}"${w.id === sel ? ' selected' : ''}>${esc(w.icon)} ${esc(w.name)}</option>`).join('');
  f.elements.from.innerHTML = opts(from);
  f.elements.to.innerHTML = opts(to);
  f.elements.date.value = today();
  updateMoveHint();
  $('#move-dialog').showModal();
}

function updateMoveHint() {
  const f = $('#move-form');
  const w = walletById(f.elements.from.value);
  if (!w) return;
  const bal = walletStats().get(w.id).balance;
  const amount = parseMoney(f.elements.amount.value) ?? 0;
  $('#move-hint').textContent = `${w.icon} ${w.name} đang ${bal < 0 ? `âm ${fmtVND(-bal)}` : `có ${fmtVND(bal)}`}${amount > bal ? ' — chuyển xong sẽ âm' : ''}`;
}

function setupWallets() {
  $('#wallet-icons').innerHTML = WALLET_ICONS.map(i =>
    `<label class="icon-opt"><input type="radio" name="icon" value="${i}" aria-label="${i}"><span aria-hidden="true">${i}</span></label>`).join('');
  $('#wallet-suggest').innerHTML = WALLET_SUGGEST.map((s, i) =>
    `<button type="button" class="chip" data-wsuggest="${i}">${esc(s.icon)} ${esc(s.name)}</button>`).join('');
  $('#wallet-alloc').addEventListener('click', () => openAlloc());
  $('#wallet-move').addEventListener('click', () => openMove());

  // ----- Thêm / sửa ví -----
  const wf = $('#wallet-form');
  $('#wallet-suggest').addEventListener('click', e => {
    const chip = e.target.closest('[data-wsuggest]');
    if (!chip) return;
    const s = WALLET_SUGGEST[Number(chip.dataset.wsuggest)];
    wf.elements.name.value = s.name;
    wf.elements.icon.value = s.icon;
    walletCats = new Set(s.cats.filter(c => state.categories.some(x => x.id === c)));
    renderWalletCats();
  });
  $('#wallet-cats').addEventListener('click', e => {
    const b = e.target.closest('[data-wcat]');
    if (!b) return;
    const id = b.dataset.wcat;
    walletCats.has(id) ? walletCats.delete(id) : walletCats.add(id);
    renderWalletCats();
  });
  wf.elements.share.addEventListener('input', updateShareHint);
  $('#wallet-history').addEventListener('click', e => {
    const del = e.target.closest('[data-alloc-del]');
    if (del) removeAllocs([del.dataset.allocDel], 'Đã xoá lần nạp');
  });
  $('#wallet-move-from').addEventListener('click', () => openMove(walletEditing?.id));
  wf.addEventListener('submit', async e => {
    if (e.submitter?.value !== 'save' || !store.unlocked) return;
    const name = capitalize(wf.elements.name.value.trim());
    const share = parseShare(wf.elements.share.value, parseMoney);
    if (!name || share === undefined) {
      e.preventDefault();
      return setFormError(wf, !name ? 'Nhập tên ví.' : 'Tỉ lệ chưa đúng — ví dụ 30% hoặc 3tr.');
    }
    const fields = {
      name, share, icon: wf.elements.icon.value || '👛', cats: [...walletCats],
      catchAll: wf.elements.catchAll.checked, since: wf.elements.since.value || monthStart(today()),
    };
    const w = walletEditing
      ? { ...walletEditing, ...fields }
      : { id: crypto.randomUUID(), tint: nextTint(state.wallets), order: nextOrder(state.wallets), ...fields };
    state.wallets = upsertWallet(state.wallets, w, new Date().toISOString());
    await saveProfile();
    renderWallets();
    const pct = liveWallets(state.wallets).reduce((s, x) => s + (x.share?.pct ?? 0), 0);
    toast(`Đã ${walletEditing ? 'lưu' : 'tạo'} ví “${name}”${pct > 100 ? ` · tổng tỉ lệ các ví đang là ${pct}%` : ''}`);
  });
  $('#wallet-delete').addEventListener('click', async () => {
    const w = walletEditing;
    if (!w || !confirm(`Xoá ví “${w.name}”? Các khoản chi vẫn giữ nguyên, chỉ thôi theo dõi số dư của ví này.`)) return;
    state.wallets = state.wallets.map(x => (x.id === w.id ? { id: w.id, deleted: true, updatedAt: new Date().toISOString() } : x));
    await saveProfile();
    $('#wallet-dialog').close();
    renderWallets();
    toast(`Đã xoá ví “${w.name}”`, {
      action: 'Hoàn tác',
      onAction: async () => {
        state.wallets = state.wallets.map(x => (x.id === w.id ? { ...w, updatedAt: new Date().toISOString() } : x));
        await saveProfile();
        renderWallets();
      },
    });
  });

  // ----- Chia tiền vào ví -----
  const af = $('#alloc-form');
  af.elements.total.addEventListener('input', () => (allocTouched ? updateAllocRest() : fillAlloc()));
  $('#alloc-rows').addEventListener('input', () => { allocTouched = true; updateAllocRest(); });
  $('#alloc-refill').addEventListener('click', fillAlloc);
  af.addEventListener('submit', async e => {
    if (e.submitter?.value !== 'ok' || !store.unlocked) return;
    const rows = allocRows();
    const given = rows.reduce((s, r) => s + (r.amount || 0), 0);
    const total = allocTotal();
    const err = rows.some(r => Number.isNaN(r.amount) || r.amount < 0) ? 'Có ví nhập số tiền chưa đúng.'
      : !given ? 'Chưa có ví nào được chia tiền.'
        : total && given > total ? `Các ví cộng lại vượt ${fmtVND(given - total)} so với số tiền.` : '';
    if (err) {
      e.preventDefault();
      return setFormError(af, err);
    }
    const now = new Date().toISOString();
    const group = crypto.randomUUID();
    const date = af.elements.date.value || today();
    const items = rows.filter(r => r.amount > 0).map(r => ({
      id: crypto.randomUUID(), date, wallet: r.wallet, amount: r.amount, kind: 'in', group, createdAt: now, updatedAt: now,
    }));
    state.allocs = [...state.allocs, ...items];
    await saveProfile();
    refreshWalletViews();
    toast(`Đã chia ${fmtVND(given)} vào ${items.length} ví`, {
      action: 'Hoàn tác', onAction: () => removeAllocs(items.map(i => i.id), 'Đã huỷ lần chia'),
    });
  });

  // ----- Chuyển giữa các ví -----
  const mf = $('#move-form');
  mf.addEventListener('input', updateMoveHint);
  mf.addEventListener('change', updateMoveHint);
  mf.addEventListener('submit', async e => {
    if (e.submitter?.value !== 'ok' || !store.unlocked) return;
    const from = mf.elements.from.value;
    const to = mf.elements.to.value;
    const amount = parseMoney(mf.elements.amount.value);
    if (from === to || !(amount > 0)) {
      e.preventDefault();
      return setFormError(mf, from === to ? 'Chọn hai ví khác nhau.' : 'Số tiền chưa hợp lệ.');
    }
    const now = new Date().toISOString();
    const group = crypto.randomUUID();
    const date = mf.elements.date.value || today();
    const leg = (wallet, amt) => ({ id: crypto.randomUUID(), date, wallet, amount: amt, kind: 'move', group, createdAt: now, updatedAt: now });
    const items = [leg(from, -amount), leg(to, amount)];
    state.allocs = [...state.allocs, ...items];
    await saveProfile();
    refreshWalletViews();
    toast(`Đã chuyển ${fmtVND(amount)}: ${walletById(from).name} → ${walletById(to).name}`, {
      action: 'Hoàn tác', onAction: () => removeAllocs([items[0].id], 'Đã huỷ lần chuyển'),
    });
  });
}

// ---------- Tài sản: tiền mặt, ngân hàng, ví điện tử, thẻ tín dụng… ----------
// Tài sản + các lần chuyển / điều chỉnh nằm trong hồ sơ đã mã hoá. Khoản thu/chi có assetId thì cộng/trừ vào đó (xem js/assets.js).

const assetById = id => liveAssets(state.assets).find(a => a.id === id);
const assetStats = () => assetBalances(state.assets, state.assetMoves, state.txs, monthOf(today()));

/** <option> chọn tài sản. noneLabel: dòng đầu (không gắn / mặc định / tất cả). */
function assetOptions(selected, noneLabel = 'Không tính vào tài sản') {
  const list = liveAssets(state.assets);
  const opt = (id, label) => `<option value="${esc(id)}"${id === selected ? ' selected' : ''}>${esc(label)}</option>`;
  return opt('', noneLabel) + list.map(a => opt(a.id, `${a.icon} ${a.name}`)).join('')
    + (selected && !list.some(a => a.id === selected) ? opt(selected, '(tài sản đã xoá)') : '');
}

/** "💵 Tiền mặt còn 1,2tr" cho các tài sản vừa bị trừ / cộng. */
function assetNote(txs) {
  const ids = [...new Set(txs.map(t => t.assetId).filter(id => id && assetById(id)))].slice(0, 2);
  if (!ids.length) return '';
  const stats = assetStats();
  return ' · ' + ids.map(id => {
    const a = assetById(id);
    const b = stats.get(id).balance;
    return `${a.icon} ${a.name} ${b < 0 ? `${a.kind === 'credit' ? 'nợ' : 'âm'} ${fmtCompact(-b)}` : `còn ${fmtCompact(b)}`}`;
  }).join(', ');
}

function renderAssets() {
  $('#asset-card').hidden = !store.unlocked;
  if (!store.unlocked) return;
  const list = liveAssets(state.assets);
  // "+ Thêm" nằm ở hàng nút (luôn thấy) — để cuối hàng ô cuộn ngang thì có nhiều tài sản sẽ bị đẩy khuất
  $('#asset-actions').hidden = !list.length;
  $('#asset-move').hidden = list.length < 2;
  if (!list.length) {
    $('#asset-total').textContent = '';
    $('#asset-strip').innerHTML = `<div class="wallet-empty">
      <p class="muted">Ghi lại tiền đang nằm ở đâu — tiền mặt, ngân hàng, Momo… Nói kèm tên tài sản khi ghi (<q>thịt bò năm mươi nghìn tiền mặt</q>) là app tự trừ đúng chỗ.</p>
      <div class="btn-row"><button type="button" class="btn primary" data-asset-suggest="0">💵 Thêm Tiền mặt</button><button type="button" class="btn" data-asset-new>+ Tài sản khác</button></div>
    </div>`;
    return;
  }
  const stats = assetStats();
  const total = list.reduce((s, a) => s + stats.get(a.id).balance, 0);
  const totalEl = $('#asset-total');
  totalEl.textContent = `Tổng ${signedCompact(total)}`;
  totalEl.classList.toggle('neg', total < 0);
  $('#asset-strip').innerHTML = list.map(a => {
    const s = stats.get(a.id);
    const debt = a.kind === 'credit' && s.balance < 0;
    const sub = [debt ? 'đang nợ' : a.isDefault ? '★ mặc định' : ASSET_KINDS[a.kind]?.label ?? '',
      s.monthOut ? `chi ${fmtCompact(s.monthOut)}` : ''].filter(Boolean).join(' · ');
    return `<button type="button" class="wallet-tile tint-${a.tint}${s.balance < 0 && !debt ? ' over' : ''}" data-asset="${esc(a.id)}">
      <span class="wt-head"><span class="wt-icon" aria-hidden="true">${esc(a.icon)}</span><span class="wt-name">${esc(a.name)}</span></span>
      <b class="wt-bal">${signedCompact(s.balance)}</b>
      <span class="wt-sub">${esc(sub)}</span>
    </button>`;
  }).join('');
}

function refreshAssetViews() {
  renderAssets();
  if ($('#asset-dialog').open && assetEditing) renderAssetDetail(assetById(assetEditing.id) ?? assetEditing);
}

/** Ô số dư: "1,2tr", "-2tr" (thẻ tín dụng đang nợ), "0" hoặc trống = 0. Sai → null. */
function parseBalance(text) {
  const s = String(text ?? '').trim();
  if (!s || /^[-−]?0+$/.test(s)) return 0;
  const neg = /^[-−]/.test(s);
  const v = parseMoney(neg ? s.slice(1) : s);
  return v == null ? null : neg ? -v : v;
}
const balanceText = n => (n ? `${n < 0 ? '-' : ''}${fmtNum(Math.abs(n))}` : '0');

let assetEditing = null;

function renderAssetDetail(a) {
  const s = assetStats().get(a.id);
  const label = s.balance < 0 ? (a.kind === 'credit' ? 'Đang nợ' : 'Âm') : 'Số dư';
  $('#asset-stat').innerHTML = `<b class="${s.balance < 0 && a.kind !== 'credit' ? 'bad' : ''}">${label} ${fmtVND(Math.abs(s.balance))}</b>
    <span>Tháng ${Number(today().slice(5, 7))}: thu ${fmtVND(s.monthIn)} · chi ${fmtVND(s.monthOut)}</span>`;
  const list = liveMoves(state.assetMoves, state.assets).filter(m => m.asset === a.id || m.from === a.id || m.to === a.id)
    .sort((x, y) => y.date.localeCompare(x.date) || (y.createdAt ?? '').localeCompare(x.createdAt ?? '')).slice(0, 12);
  $('#asset-history').innerHTML = list.length ? list.map(m => {
    const other = id => assetById(id)?.name ?? 'tài sản đã xoá';
    const amt = m.kind === 'adjust' ? m.amount : m.from === a.id ? -m.amount : m.amount;
    const what = m.kind === 'adjust' ? 'điều chỉnh số dư' : m.from === a.id ? `chuyển sang ${other(m.to)}` : `nhận từ ${other(m.from)}`;
    return `<li><span><b>${amt < 0 ? '−' : '+'}${fmtVND(Math.abs(amt))}</b><small>${esc(dayLabel(m.date))} · ${esc(what)}</small></span>
      <button type="button" class="icon-btn" data-amove-del="${esc(m.id)}" aria-label="Xoá lần này">✕</button></li>`;
  }).join('') : '<li class="empty">Chưa có lần chuyển hay điều chỉnh nào.</li>';
}

function fillAssetForm(s) {
  const f = $('#asset-form');
  f.elements.name.value = s.name ?? '';
  f.elements.kind.value = s.kind ?? 'cash';
  f.elements.icon.value = s.icon ?? ASSET_KINDS[f.elements.kind.value].icon;
  f.elements.aliases.value = (s.aliases ?? []).join(', ');
}

function openAsset(id, suggest) {
  if (!store.unlocked) return;
  const f = $('#asset-form');
  const a = id ? assetById(id) : null;
  assetEditing = a;
  f.reset();
  setFormError(f, '');
  $('#asset-title').textContent = a ? `${a.icon} ${a.name}` : 'Thêm tài sản';
  $('#asset-suggest').hidden = !!a;
  $('#asset-delete').hidden = !a;
  $('#asset-more').hidden = !a;
  $('#asset-stat').hidden = !a;
  $('#asset-balance-label').textContent = a ? 'Số dư hiện tại' : 'Số dư ban đầu';
  fillAssetForm(a ?? suggest ?? {});
  f.elements.balance.value = a ? balanceText(assetStats().get(a.id).balance) : '';
  // Tài sản đầu tiên tự là mặc định
  f.elements.isDefault.checked = a ? !!a.isDefault : !defaultAsset(state.assets);
  updateAssetBalanceHint();
  if (a) renderAssetDetail(a);
  $('#asset-dialog').showModal();
}

function updateAssetBalanceHint() {
  const f = $('#asset-form');
  const v = parseBalance(f.elements.balance.value);
  const credit = f.elements.kind.value === 'credit';
  const cur = assetEditing ? assetStats().get(assetEditing.id)?.balance ?? 0 : null;
  $('#asset-balance-hint').textContent = v == null ? 'Chưa hiểu — ví dụ 1,5tr hoặc 500k'
    : cur != null && v !== cur ? `Sẽ ghi một lần điều chỉnh ${v > cur ? '+' : '−'}${fmtVND(Math.abs(v - cur))} hôm nay`
      : credit ? 'Thẻ tín dụng đang nợ thì nhập số âm, ví dụ -2tr'
        : assetEditing ? 'Đổi số này nếu đếm lại thấy lệch — app ghi phần chênh lệch' : 'Số tiền đang có lúc bắt đầu theo dõi';
}

async function removeAssetMoves(ids, msg) {
  const now = new Date().toISOString();
  const gone = state.assetMoves.filter(m => !m.deleted && ids.includes(m.id));
  state.assetMoves = state.assetMoves.map(m => (ids.includes(m.id) ? { id: m.id, deleted: true, updatedAt: now } : m));
  await saveProfile();
  refreshAssetViews();
  toast(msg, {
    action: 'Hoàn tác',
    onAction: async () => {
      const t = new Date().toISOString();
      state.assetMoves = state.assetMoves.map(m => (ids.includes(m.id) ? { ...gone.find(g => g.id === m.id), updatedAt: t } : m));
      await saveProfile();
      refreshAssetViews();
    },
  });
}

function openAssetMove(fromId) {
  if (!store.unlocked) return;
  const list = liveAssets(state.assets);
  if (list.length < 2) return toast('Cần ít nhất 2 tài sản để chuyển tiền');
  const f = $('#amove-form');
  f.reset();
  setFormError(f, '');
  const from = assetById(fromId)?.id ?? list[0].id;
  const to = list.find(a => a.id !== from).id;
  const opts = sel => list.map(a => `<option value="${esc(a.id)}"${a.id === sel ? ' selected' : ''}>${esc(a.icon)} ${esc(a.name)}</option>`).join('');
  f.elements.from.innerHTML = opts(from);
  f.elements.to.innerHTML = opts(to);
  f.elements.date.value = today();
  updateAssetMoveHint();
  $('#amove-dialog').showModal();
}

function updateAssetMoveHint() {
  const f = $('#amove-form');
  const a = assetById(f.elements.from.value);
  if (!a) return;
  const bal = assetStats().get(a.id).balance;
  const amount = parseMoney(f.elements.amount.value) ?? 0;
  $('#amove-hint').textContent = `${a.icon} ${a.name} đang ${bal < 0 ? `${a.kind === 'credit' ? 'nợ' : 'âm'} ${fmtVND(-bal)}` : `có ${fmtVND(bal)}`}`
    + (amount > bal && a.kind !== 'credit' ? ' — chuyển xong sẽ âm' : '');
}

function setupAssets() {
  $('#asset-icons').innerHTML = ASSET_ICONS.map(i =>
    `<label class="icon-opt"><input type="radio" name="icon" value="${i}" aria-label="${i}"><span aria-hidden="true">${i}</span></label>`).join('');
  $('#asset-kind').innerHTML = Object.entries(ASSET_KINDS).map(([k, v]) => `<option value="${k}">${v.icon} ${esc(v.label)}</option>`).join('');
  $('#asset-suggest').innerHTML = ASSET_SUGGEST.map((s, i) =>
    `<button type="button" class="chip" data-asuggest="${i}">${esc(s.icon)} ${esc(s.name)}</button>`).join('');
  $('#asset-move').addEventListener('click', () => openAssetMove());

  const f = $('#asset-form');
  $('#asset-suggest').addEventListener('click', e => {
    const chip = e.target.closest('[data-asuggest]');
    if (!chip) return;
    fillAssetForm(ASSET_SUGGEST[Number(chip.dataset.asuggest)]);
    updateAssetBalanceHint();
  });
  // Đổi loại → đổi biểu tượng theo (nếu đang là biểu tượng của một loại)
  const kindIcons = new Set(Object.values(ASSET_KINDS).map(k => k.icon));
  f.elements.kind.addEventListener('change', () => {
    if (!f.elements.icon.value || kindIcons.has(f.elements.icon.value)) f.elements.icon.value = ASSET_KINDS[f.elements.kind.value].icon;
    updateAssetBalanceHint();
  });
  f.elements.balance.addEventListener('input', updateAssetBalanceHint);
  $('#asset-history').addEventListener('click', e => {
    const del = e.target.closest('[data-amove-del]');
    if (del) removeAssetMoves([del.dataset.amoveDel], 'Đã xoá');
  });
  $('#asset-move-from').addEventListener('click', () => openAssetMove(assetEditing?.id));
  $('#asset-show-history').addEventListener('click', () => {
    if (!assetEditing) return;
    state.histAsset = assetEditing.id;
    state.histCat = '';
    state.month = monthOf(today());
    $('#asset-dialog').close();
    showView('history');
  });

  f.addEventListener('submit', async e => {
    if (e.submitter?.value !== 'save' || !store.unlocked) return;
    const name = capitalize(f.elements.name.value.trim());
    const balance = parseBalance(f.elements.balance.value);
    if (!name || balance == null) {
      e.preventDefault();
      return setFormError(f, !name ? 'Nhập tên tài sản.' : 'Số dư chưa đúng — ví dụ 1,5tr hoặc -2tr.');
    }
    const kind = f.elements.kind.value;
    const fields = {
      name, kind, icon: f.elements.icon.value || ASSET_KINDS[kind].icon,
      aliases: parseAliases(f.elements.aliases.value), isDefault: f.elements.isDefault.checked,
    };
    const now = new Date().toISOString();
    let a;
    let adjust = null;
    if (assetEditing) {
      a = { ...assetEditing, ...fields };
      const cur = assetStats().get(a.id)?.balance ?? 0;
      if (balance !== cur) {
        adjust = { id: crypto.randomUUID(), date: today(), kind: 'adjust', asset: a.id, amount: balance - cur, createdAt: now, updatedAt: now };
      }
    } else {
      a = { id: crypto.randomUUID(), tint: nextAssetTint(state.assets), order: nextAssetOrder(state.assets), opening: balance, createdAt: now, ...fields };
    }
    state.assets = upsertAsset(state.assets, a, now);
    if (adjust) state.assetMoves = [...state.assetMoves, adjust];
    await saveProfile();
    renderAssets();
    toast(`Đã ${assetEditing ? 'lưu' : 'thêm'} “${name}”${adjust ? ` · điều chỉnh ${adjust.amount > 0 ? '+' : '−'}${fmtCompact(Math.abs(adjust.amount))}` : ''}`
      + (a.isDefault ? ' · tài sản mặc định' : ''));
  });

  $('#asset-delete').addEventListener('click', async () => {
    const a = assetEditing;
    if (!a || !confirm(`Xoá tài sản “${a.name}”? Các khoản đã ghi vẫn giữ nguyên, chỉ thôi tính vào tài sản này.`)) return;
    const now = new Date().toISOString();
    const before = state.assets;
    state.assets = state.assets.map(x => (x.id === a.id ? { id: a.id, deleted: true, updatedAt: now } : x));
    // Xoá tài sản mặc định → tài sản đầu tiên còn lại làm mặc định
    const next = a.isDefault ? liveAssets(state.assets)[0] : null;
    if (next) state.assets = upsertAsset(state.assets, { ...next, isDefault: true }, now);
    await saveProfile();
    $('#asset-dialog').close();
    renderAssets();
    toast(`Đã xoá “${a.name}”`, {
      action: 'Hoàn tác',
      onAction: async () => {
        const t = new Date().toISOString();
        state.assets = before.map(x => ({ ...x, updatedAt: t }));
        await saveProfile();
        renderAssets();
      },
    });
  });

  // ----- Chuyển tiền giữa các tài sản (rút ATM, nạp Momo, trả thẻ tín dụng) -----
  const mf = $('#amove-form');
  mf.addEventListener('input', updateAssetMoveHint);
  mf.addEventListener('change', updateAssetMoveHint);
  mf.addEventListener('submit', async e => {
    if (e.submitter?.value !== 'ok' || !store.unlocked) return;
    const from = mf.elements.from.value;
    const to = mf.elements.to.value;
    const amount = parseMoney(mf.elements.amount.value);
    if (from === to || !(amount > 0)) {
      e.preventDefault();
      return setFormError(mf, from === to ? 'Chọn hai tài sản khác nhau.' : 'Số tiền chưa hợp lệ.');
    }
    const now = new Date().toISOString();
    const m = { id: crypto.randomUUID(), date: mf.elements.date.value || today(), kind: 'move', from, to, amount, createdAt: now, updatedAt: now };
    state.assetMoves = [...state.assetMoves, m];
    await saveProfile();
    refreshAssetViews();
    toast(`Đã chuyển ${fmtVND(amount)}: ${assetById(from).name} → ${assetById(to).name}`, {
      action: 'Hoàn tác', onAction: () => removeAssetMoves([m.id], 'Đã huỷ lần chuyển'),
    });
  });
}

// ---------- Người khác nợ bạn (chi hộ bạn bè) ----------
// Nợ nằm ngay trong khoản chi (owes / refunds, xem js/refunds.js) nên đồng bộ và mã hoá cùng khoản.

let repayKey = null;

function renderDebts() {
  const card = $('#debt-card');
  const debts = store.unlocked ? debtsByPerson(state.txs) : [];
  card.hidden = !debts.length;
  if (!debts.length) return;
  $('#debt-total').textContent = `Tổng ${fmtCompact(debts.reduce((s, p) => s + p.left, 0))}`;
  $('#debt-people').innerHTML = debts.map(p => `<li class="debt-person">
      <span class="debt-who"><b>${esc(p.name)}</b><small>${esc(p.items.map(i => i.tx.name).slice(0, 3).join(', '))}${p.items.length > 3 ? ` +${p.items.length - 3}` : ''}</small></span>
      <b class="debt-amt">${fmtCompact(p.left)}</b>
      <button type="button" class="btn chip-btn" data-repay="${esc(p.key)}">↩️ Đã trả</button>
    </li>`).join('');
}

function openRepay(key) {
  const p = debtsByPerson(state.txs).find(x => x.key === key);
  if (!p || !store.unlocked) return;
  repayKey = key;
  const f = $('#repay-form');
  f.reset();
  setFormError(f, '');
  $('#repay-title').textContent = `↩️ ${p.name} trả lại`;
  $('#repay-items').innerHTML = p.items.map(({ tx, left }) => {
    const c = catById(tx.category);
    return `<li class="merge-row tint-${c.tint}">
      <span class="tx-icon" aria-hidden="true">${esc(c.icon)}</span>
      <span class="tx-main"><span class="tx-name">${esc(tx.name)}</span><span class="tx-sub">${esc(dayLabel(tx.date))} · ${fmtCompact(tx.amount)}</span></span>
      <span class="tx-amt">${fmtVND(left)}</span></li>`;
  }).join('');
  f.elements.amount.value = fmtNum(p.left);
  f.elements.date.value = today();
  f.elements.assetId.innerHTML = assetOptions(defaultAsset(state.assets)?.id ?? '', 'Không tính vào tài sản');
  $('#repay-asset-row').hidden = !liveAssets(state.assets).length;
  $('#repay-dialog').showModal();
}

function setupDebts() {
  $('#debt-people').addEventListener('click', e => {
    const b = e.target.closest('[data-repay]');
    if (b) openRepay(b.dataset.repay);
  });
  const f = $('#repay-form');
  f.addEventListener('submit', async e => {
    if (e.submitter?.value !== 'ok' || !store.unlocked) return;
    const p = debtsByPerson(state.txs).find(x => x.key === repayKey);
    const amount = parseMoney(f.elements.amount.value);
    if (!p || !(amount > 0) || amount > p.left) {
      e.preventDefault();
      return setFormError(f, !(amount > 0) ? 'Số tiền chưa hợp lệ.' : `${p?.name ?? 'Người này'} chỉ còn nợ ${fmtVND(p?.left ?? 0)}.`);
    }
    const now = new Date().toISOString();
    const date = f.elements.date.value || today();
    const assetId = f.elements.assetId.value;
    const { plan } = planRepayment(state.txs, repayKey, amount);
    const originals = plan.map(x => x.tx);
    const updated = plan.map(({ tx, amount: a }) => ({
      ...tx, updatedAt: now,
      refunds: [...(tx.refunds ?? []), { id: crypto.randomUUID(), person: p.name, amount: a, ...(assetId ? { assetId } : {}), date, createdAt: now }],
    }));
    await store.putTx(updated);
    const byId = new Map(updated.map(t => [t.id, t]));
    state.txs = state.txs.map(t => byId.get(t.id) ?? t);
    renderTopbar();
    renderView(state.view);
    toast(`↩️ ${p.name} trả ${fmtVND(amount)}${updated.length > 1 ? ` cho ${updated.length} khoản` : ''}${assetNote(assetId ? [{ assetId }] : [])}`, {
      action: 'Hoàn tác', onAction: () => restoreTxs(originals),
    });
  });
}

// ---------- Khoản cố định hằng tháng ----------

/** Ghi các khoản cố định đã tới ngày (ghi bù nếu lỡ). Trả về số khoản vừa ghi. */
async function runRecurring({ quiet = false } = {}) {
  if (!store.unlocked || !state.recurring.length) return 0;
  const ids = new Set([...state.txs, ...state.tombs].map(t => t.id));
  const due = dueRecurring(state.recurring, id => ids.has(id), today());
  if (!due.length) return 0;
  // Khoản cố định chưa chọn tài sản → trừ vào tài sản mặc định lúc ghi
  const def = defaultAsset(state.assets)?.id;
  if (def) due.forEach(t => { t.assetId ??= def; });
  await store.putTx(due);
  state.txs.push(...due);
  if (!quiet) toast(`🔁 Đã ghi ${due.length} khoản cố định: ${[...new Set(due.map(t => t.name))].join(', ')}`);
  return due.length;
}

const shortDate = iso => { const [, m, d] = iso.split('-').map(Number); return `${d}/${m}`; };

function renderRecurring() {
  const rules = activeRules(state.recurring).sort((a, b) => a.day - b.day || a.name.localeCompare(b.name, 'vi'));
  const monthly = sum(rules.filter(r => r.active && r.type !== 'income'));
  $('#rec-total').textContent = monthly ? `${fmtVND(monthly)}/tháng` : '';
  $('#rec-list').innerHTML = rules.length ? rules.map(r => {
    const c = catById(r.category);
    const asset = r.assetId ? assetById(r.assetId) : null;
    return `<li><button type="button" class="tx rec-row tint-${c.tint}${r.active ? '' : ' off'}" data-rec="${esc(r.id)}">
      <span class="tx-icon" aria-hidden="true">${esc(c.icon)}</span>
      <span class="tx-main"><span class="tx-name">${esc(r.name)}</span>
        <span class="tx-sub">Ngày ${r.day} hằng tháng · ${r.active ? `kế tiếp ${shortDate(nextDue(r, today()))}` : 'đang tắt'}${asset ? ` · ${esc(asset.icon)} ${esc(asset.name)}` : ''}</span></span>
      <span class="tx-amt">${fmtVND(r.amount)}</span>
    </button></li>`;
  }).join('') : '<li class="empty">Chưa có khoản nào.</li>';
}

let recEditing = null;
let recCatTouched = false;

function openRec(id) {
  const f = $('#rec-form');
  const rule = id ? state.recurring.find(r => r.id === id) : null;
  recEditing = rule;
  recCatTouched = !!rule;
  f.reset();
  setFormError(f, '');
  $('#rec-title').textContent = rule ? 'Sửa khoản cố định' : 'Thêm khoản cố định';
  $('#rec-suggest').hidden = !!rule;
  $('#rec-delete').hidden = !rule;
  $('#rec-this-month-row').hidden = !!rule;
  $('#rec-active-row').hidden = !rule;
  f.elements.name.value = rule?.name ?? '';
  f.elements.amount.value = rule ? fmtNum(rule.amount) : '';
  f.elements.day.value = String(rule?.day ?? Number(today().slice(8)));
  f.elements.category.innerHTML = categoryOptions(rule?.category ?? 'giai-tri');
  f.elements.assetId.innerHTML = assetOptions(rule?.assetId ?? '', 'Tài sản mặc định');
  $('#rec-asset-row').hidden = !liveAssets(state.assets).length && !rule?.assetId;
  f.elements.active.checked = rule?.active ?? true;
  updateRecThisMonth();
  $('#rec-dialog').showModal();
  if (!rule) setTimeout(() => f.elements.name.focus(), 50);
}

function updateRecThisMonth() {
  const f = $('#rec-form');
  const ym = ymOf(today());
  const day = Number(f.elements.day.value);
  const [y, m] = ym.split('-').map(Number);
  const d = Math.min(day, new Date(y, m, 0).getDate());
  const due = `${ym}-${String(d).padStart(2, '0')}`;
  $('#rec-this-month').textContent = due < today() ? `Ghi luôn tháng này (ngày ${d}/${m} đã qua)`
    : due === today() ? `Ghi luôn hôm nay (${d}/${m})` : `Tính từ tháng này (ngày ${d}/${m})`;
}

function setupRecurring() {
  const dlg = $('#rec-dialog');
  const f = $('#rec-form');
  $('#rec-add').addEventListener('click', () => openRec());
  $('#rec-list').addEventListener('click', e => {
    const row = e.target.closest('[data-rec]');
    if (row) openRec(row.dataset.rec);
  });
  $('#rec-suggest').addEventListener('click', e => {
    const chip = e.target.closest('[data-rec-name]');
    if (!chip) return;
    f.elements.name.value = chip.dataset.recName;
    f.elements.name.dispatchEvent(new Event('input', { bubbles: true }));
    f.elements.amount.focus();
  });
  // Danh mục tự theo tên ("Netflix" → Giải trí, "Phí giữ xe" → Di chuyển) trừ khi bạn đã tự chọn
  f.elements.name.addEventListener('input', e => {
    if (recCatTouched) return;
    const c = classify(e.target.value, state.categories, state.learned);
    if (c) f.elements.category.value = c;
  });
  f.elements.category.addEventListener('change', () => { recCatTouched = true; });
  f.elements.day.addEventListener('change', updateRecThisMonth);

  f.addEventListener('submit', async e => {
    if (e.submitter?.value !== 'save' || !store.unlocked) return;
    const name = capitalize(f.elements.name.value.trim());
    const amount = parseAmountInput(f.elements.amount.value, { slang: state.settings.slang });
    const day = Number(f.elements.day.value);
    if (!name || !amount) {
      e.preventDefault();
      return setFormError(f, !name ? 'Nhập tên khoản.' : 'Số tiền chưa hợp lệ.');
    }
    const cat = catById(f.elements.category.value);
    const now = new Date().toISOString();
    const t = today();
    let rule;
    if (recEditing) {
      const active = f.elements.active.checked;
      rule = { ...recEditing, name, amount, day, category: cat.id, type: cat.type, active, updatedAt: now };
      // Bật lại sau khi tạm dừng: không ghi bù những tháng đã tắt
      if (active && !recEditing.active) rule.startYm = startYmFor(day, t);
    } else {
      rule = {
        id: crypto.randomUUID(), name, amount, day, category: cat.id, type: cat.type, active: true,
        startYm: f.elements.thisMonth.checked ? ymOf(t) : nextYm(ymOf(t)), updatedAt: now,
      };
    }
    if (f.elements.assetId.value) rule.assetId = f.elements.assetId.value;
    else delete rule.assetId;
    state.recurring = [...state.recurring.filter(r => r.id !== rule.id), rule];
    await saveProfile();
    const n = await runRecurring({ quiet: true });
    renderRecurring();
    renderTopbar();
    toast(n ? `Đã lưu “${name}” và ghi ${n} khoản tới hạn` : `Đã lưu “${name}” · kế tiếp ${shortDate(nextDue(rule, t))}`);
  });

  $('#rec-delete').addEventListener('click', async () => {
    if (!recEditing || !confirm(`Xoá khoản cố định “${recEditing.name}”? Các khoản đã ghi trước đây vẫn giữ nguyên.`)) return;
    const gone = { id: recEditing.id, deleted: true, updatedAt: new Date().toISOString() };
    state.recurring = [...state.recurring.filter(r => r.id !== gone.id), gone];
    await saveProfile();
    dlg.close();
    renderRecurring();
    toast('Đã xoá khoản cố định');
  });
}

// ---------- Gộp nhiều khoản thành một hoá đơn ----------
// Ví dụ đi siêu thị mua lắt nhắt nhiều lần → cuối ngày gộp thành "Siêu thị" có các món bên trong.
// Mỗi khoản cũ thành một món (giữ danh mục riêng → thống kê không đổi); khoản cũ để lại dấu xoá để máy khác cũng gộp theo.

function startSelecting() {
  state.selecting = true;
  state.selected.clear();
  $('#toast').hidden = true;
  renderHistory();
}

function stopSelecting() {
  state.selecting = false;
  state.selected.clear();
  if (state.view === 'history') renderHistory();
  else renderSelection();
}

function toggleSelect(id) {
  state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id);
  renderSelection();
}

const selectedTxs = () => state.txs.filter(t => state.selected.has(t.id))
  .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));

function renderSelection() {
  const on = state.selecting && state.view === 'history';
  $('#hist-list').classList.toggle('selecting', on);
  $$('#hist-list .tx').forEach(b => {
    b.classList.toggle('picked', on && state.selected.has(b.dataset.id));
    if (on) b.setAttribute('aria-pressed', String(state.selected.has(b.dataset.id)));
    else b.removeAttribute('aria-pressed');
  });
  $('#select-btn').textContent = state.selecting ? 'Xong' : '☑️ Gộp khoản';
  $('#merge-bar').hidden = !on;
  const items = selectedTxs();
  const mixed = new Set(items.map(t => t.type)).size > 1;
  $('#merge-count').textContent = items.length
    ? (mixed ? 'Không gộp chung khoản chi với khoản thu' : `Đã chọn ${items.length} · ${fmtVND(sum(items))}`)
    : 'Chạm vào các khoản muốn gộp';
  $('#merge-go').disabled = items.length < 2 || mixed;
  syncSelectLayer();
}

// Back khi đang chọn để gộp = thôi chọn
let selectLayer = null;
function syncSelectLayer() {
  if (state.selecting && !selectLayer) selectLayer = openLayer(stopSelecting);
  else if (!state.selecting && selectLayer) {
    selectLayer();
    selectLayer = null;
  }
}

let mergeItems = [];
let mergeCatTouched = false;

function openMerge() {
  mergeItems = selectedTxs();
  if (mergeItems.length < 2) return;
  // Hoá đơn chỉ trừ vào một tài sản — gộp khoản tiền mặt với khoản Momo sẽ làm sai số dư
  if (new Set(mergeItems.map(t => t.assetId ?? '')).size > 1) {
    return toast('Các khoản này trả bằng tài sản khác nhau — sửa cho giống nhau rồi gộp');
  }
  const f = $('#merge-form');
  const type = mergeItems[0].type;
  // Gợi ý: danh mục chiếm nhiều tiền nhất, ngày muộn nhất
  const byCat = new Map();
  mergeItems.flatMap(partsOf).forEach(p => byCat.set(p.category, (byCat.get(p.category) ?? 0) + p.amount));
  const topCat = [...byCat].sort((a, b) => b[1] - a[1])[0][0];
  f.reset();
  f.elements.name.value = catById(topCat).type === type ? catById(topCat).name : '';
  f.elements.category.innerHTML = categoryOptions(catById(topCat).type === type ? topCat : FALLBACK[type], type);
  f.elements.date.value = mergeItems.map(t => t.date).sort().at(-1);
  mergeCatTouched = false;
  $('#merge-list').innerHTML = mergeItems.map(t => {
    const c = catById(t.category);
    return `<li class="merge-row tint-${c.tint}">
      <span class="tx-icon" aria-hidden="true">${esc(c.icon)}</span>
      <span class="tx-main"><span class="tx-name">${esc(t.name)}</span><span class="tx-sub">${esc(dayLabel(t.date))} ${esc(timeOf(t.createdAt))}${t.splits?.length ? ` · ${t.splits.length} món` : ''}</span></span>
      <span class="tx-amt">${fmtVND(t.amount)}</span></li>`;
  }).join('');
  $('#merge-total').textContent = `Tổng ${fmtVND(sum(mergeItems))} · ${mergeItems.length} khoản`;
  $('#merge-dialog').showModal();
  setTimeout(() => f.elements.name.select(), 50);
}

function setupMerge() {
  const mf = $('#merge-form');
  // Gõ tên "Siêu thị" / "Du lịch Đà Lạt" → danh mục tự theo tên (trừ khi bạn đã tự chọn)
  mf.elements.name.addEventListener('input', e => {
    if (mergeCatTouched || !mergeItems.length) return;
    const c = classify(e.target.value, state.categories, state.learned);
    if (c && catById(c).type === mergeItems[0].type) mf.elements.category.value = c;
  });
  mf.elements.category.addEventListener('change', () => { mergeCatTouched = true; });
  mf.addEventListener('submit', async e => {
    if (e.submitter?.value !== 'ok' || !store.unlocked) return;
    const f = e.target;
    const cat = catById(f.elements.category.value);
    const now = new Date().toISOString();
    const originals = mergeItems.map(t => ({ ...t }));
    const merged = {
      id: crypto.randomUUID(),
      date: f.elements.date.value,
      name: capitalize(f.elements.name.value.trim()) || cat.name,
      amount: sum(originals),
      category: cat.id,
      type: cat.type,
      // Khoản đã chia sẵn thì lấy từng món của nó, nên gộp lồng nhau vẫn phẳng
      splits: originals.flatMap(t => grossParts(t).map(p => ({ id: crypto.randomUUID(), name: p.name, amount: p.amount, category: p.category }))),
      raw: originals.map(t => t.raw).filter(Boolean).join(' · '),
      ...(originals[0].assetId ? { assetId: originals[0].assetId } : {}),
      // Ai nợ / đã hoàn ở các khoản cũ đi theo hoá đơn gộp
      ...(originals.some(t => t.owes?.length) ? { owes: originals.flatMap(t => t.owes ?? []) } : {}),
      ...(originals.some(t => t.refunds?.length) ? { refunds: originals.flatMap(t => t.refunds ?? []) } : {}),
      createdAt: now,
      updatedAt: now,
    };
    const tombs = originals.map(t => ({ id: t.id, deleted: true, updatedAt: now }));
    await store.putTx([merged, ...tombs]);
    const gone = new Set(originals.map(t => t.id));
    state.txs = [...state.txs.filter(t => !gone.has(t.id)), merged];
    state.tombs = [...state.tombs.filter(t => !gone.has(t.id)), ...tombs];
    await learnFrom([merged]);
    stopSelecting();
    renderTopbar();
    toast(`Đã gộp ${originals.length} khoản thành “${merged.name}”`, { action: 'Hoàn tác', onAction: () => undoMerge(merged, originals) });
  });
}

async function undoMerge(merged, originals) {
  const now = new Date().toISOString();
  const restored = originals.map(t => ({ ...t, updatedAt: now }));
  const tomb = { id: merged.id, deleted: true, updatedAt: now };
  await store.putTx([...restored, tomb]);
  const back = new Set(restored.map(t => t.id));
  state.txs = [...state.txs.filter(t => t.id !== merged.id), ...restored];
  state.tombs = [...state.tombs.filter(t => !back.has(t.id) && t.id !== merged.id), tomb];
  renderTopbar();
  renderView(state.view);
  toast('Đã tách lại như cũ');
}

// ---------- Máy tính cho ô số tiền ----------
let calcTarget = null;
let calcExpr = '';

function calcValue() {
  return calcExpr ? parseAmountInput(calcExpr, { slang: state.settings.slang }) : null;
}

function renderCalc() {
  $('#calc-expr').textContent = calcExpr || '0';
  const v = calcValue();
  $('#calc-result').textContent = v ? `= ${fmtVND(v)}` : calcExpr ? '…' : '';
}

function openCalc(input) {
  if (!input) return;
  calcTarget = input;
  calcExpr = input.value.trim();
  renderCalc();
  $('#calc-dialog').showModal();
}

function calcPress(k) {
  const last = calcExpr.slice(-1);
  if (k === 'C') calcExpr = '';
  else if (k === 'back') calcExpr = calcExpr.slice(0, -1);
  else if ('+−×÷'.includes(k)) {
    if (!calcExpr) return;
    calcExpr = ('+−×÷'.includes(last) ? calcExpr.slice(0, -1) : calcExpr) + k;
  } else if (k === 'k') {
    if (/\d/.test(last)) calcExpr += 'k';
  } else if (k === '=') {
    const v = calcValue();
    if (v) calcExpr = String(v);
  } else if (k === 'ok') {
    const v = calcValue();
    if (!v) return toast('Phép tính chưa đúng');
    calcTarget.value = fmtNum(v);
    calcTarget.dispatchEvent(new Event('input', { bubbles: true }));
    calcTarget.dispatchEvent(new Event('change', { bubbles: true }));
    return $('#calc-dialog').close();
  } else if (last !== 'k') {
    calcExpr += k;
  }
  renderCalc();
}

function setupCalc() {
  const dlg = $('#calc-dialog');
  dlg.addEventListener('click', e => {
    const key = e.target.closest('[data-k]');
    if (key) return calcPress(key.dataset.k);
    if (e.target === dlg) dlg.close(); // chạm ra ngoài để đóng
  });
  // Bàn phím máy tính (khi dùng trên PC)
  dlg.addEventListener('keydown', e => {
    const map = { '*': '×', x: '×', '/': '÷', '-': '−', '+': '+', Backspace: 'back', Enter: 'ok', '=': '=', Delete: 'C', k: 'k' };
    const k = /^\d$/.test(e.key) ? e.key : map[e.key];
    if (!k) return;
    e.preventDefault();
    calcPress(k);
  });
}

// ---------- Đồng bộ Google Drive ----------
// Drive giữ MỘT file đồng bộ = bản sao lưu đã mã hoá (kho khoá + từng khoản + dấu xoá + hồ sơ).
// Mỗi lần đồng bộ: tải về → gộp (bản sửa sau cùng thắng) → ghi kết quả xuống máy → đẩy bản đã gộp lên.

const SYNC_EVERY = 6 * 3600_000;
let syncing = false;
let pendingSync = false;

function ago(iso) {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (!(m >= 1)) return 'vừa xong';
  if (m < 60) return `${m} phút trước`;
  if (m < 48 * 60) return `${Math.round(m / 60)} giờ trước`;
  return `${Math.round(m / 1440)} ngày trước`;
}

function renderSyncCard(busy) {
  const email = state.meta.googleEmail;
  $('#sync-info').innerHTML = busy ? esc(busy) : email
    ? `Đã kết nối <b>${esc(email)}</b> · đồng bộ lần cuối: ${state.meta.lastSync ? esc(ago(state.meta.lastSync)) : 'chưa'}.`
    : 'Chưa kết nối. Bấm <b>Đồng bộ ngay</b> để đăng nhập Google và đưa dữ liệu (đã mã hoá) lên Drive.';
  $('#sync-now').disabled = !!busy;
  $('#sync-disconnect').hidden = !email;
  $('#set-autosync').checked = state.settings.autoSync;
}

async function mergeRemote(remote) {
  if (!store.isBackup(remote)) throw new Error('File trên Google Drive không đúng định dạng của Coin Manager.');
  const local = store.vault;
  const otherVault = remote.vault.id !== local.id;
  // Máy này tạo mật khẩu riêng trước khi đồng bộ → hỏi mật khẩu của dữ liệu trên Drive rồi dùng chung kho khoá đó
  const read = otherVault
    ? await askPassphrase('Dữ liệu trên Google Drive dùng mật khẩu khác. Nhập mật khẩu đó để gộp — sau đó máy này dùng chung mật khẩu với Drive.',
      pass => store.readBackup(remote, pass))
    : await store.readBackup(remote);
  if (!read) throw new Error('Đã huỷ đồng bộ.');

  const remoteRows = read.txs.filter(t => isValidTx(t) || isTomb(t));
  const { rows, pulledIds } = mergeRows([...state.txs, ...state.tombs], remoteRows);
  let passChanged = false;
  if (otherVault) {
    await store.adoptVault(remote.vault, read.keys);
    await store.putTx(rows); // mã hoá lại toàn bộ bằng khoá chung
  } else {
    const changed = v => Date.parse(v.changedAt || v.createdAt || 0) || 0;
    if (changed(remote.vault) > changed(local)) {
      await store.adoptVault(remote.vault); // mật khẩu đã đổi ở máy khác (vẫn cùng khoá dữ liệu)
      passChanged = true;
    }
    await store.putTx(rows.filter(r => pulledIds.has(r.id)));
  }
  state.txs = rows.filter(r => !isTomb(r));
  state.tombs = rows.filter(isTomb);
  applyProfile(mergeProfile(profileNow(), read.profile ?? {}));
  await saveProfile();
  return { pulled: pulledIds.size, passChanged };
}

/** Phải gọi từ một lần bấm (Google cần thao tác người dùng để mở cửa sổ đăng nhập). */
async function syncNow({ auto = false } = {}) {
  if (syncing || !store.unlocked) return;
  syncing = true;
  pendingSync = false;
  renderSyncCard(gdrive.hasValidToken() || !gdrive.isStandalone() ? 'Đang đồng bộ…' : 'Đang chờ đăng nhập Google… đăng nhập xong hãy quay lại app.');
  // Đăng nhập có thể mở tab Chrome riêng → đừng tự khoá app trong lúc đó
  keepUnlockedUntil = Date.now() + 5 * 60_000;
  try {
    await gdrive.getToken({ hint: state.meta.googleEmail, action: 'sync' });
    renderSyncCard('Đang đồng bộ…');
    state.meta.googleEmail ??= await gdrive.whoAmI();
    let pulled = 0;
    let passChanged = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      const file = await gdrive.findSyncFile();
      if (file) ({ pulled, passChanged } = await mergeRemote(await gdrive.downloadSyncFile(file.id)));
      await runRecurring({ quiet: true });
      // Máy khác vừa ghi trong lúc gộp → gộp lại một lần nữa rồi mới đẩy lên
      const latest = file && attempt === 0 ? await gdrive.findSyncFile() : null;
      if (latest && latest.modifiedTime !== file.modifiedTime) continue;
      await gdrive.uploadSyncFile(await store.exportBackup(), file?.id);
      break;
    }
    state.meta.lastSync = new Date().toISOString();
    state.settings.googleConnected = true;
    await Promise.all([saveProfile(), saveSettings()]);
    renderTopbar();
    renderView(state.view);
    toast(passChanged ? 'Đã đồng bộ. Mật khẩu đã được đổi ở máy khác — lần sau mở khoá hãy dùng mật khẩu mới.'
      : pulled ? `Đã đồng bộ · lấy về ${pulled} thay đổi từ máy khác` : 'Đã đồng bộ với Google Drive ☁️');
  } catch (err) {
    if (auto) toast('Chưa tự đồng bộ được', { action: 'Đồng bộ', onAction: () => syncNow() });
    else toast(err.message);
  } finally {
    syncing = false;
    if (state.view === 'settings') renderSyncCard();
  }
}

function autoSyncAfterUnlock() {
  if (pendingSync) return syncNow();
  const last = Date.parse(state.meta.lastSync || 0) || 0;
  if (!state.settings.autoSync || !state.meta.googleEmail || Date.now() - last <= SYNC_EVERY) return;
  // App đã cài: đăng nhập phải mở tab Chrome — chỉ làm khi bạn bấm, không tự bật ra
  if (gdrive.isStandalone() && !gdrive.hasValidToken()) {
    return toast('Đến lúc đồng bộ Google Drive', { action: 'Đồng bộ', onAction: () => syncNow() });
  }
  syncNow({ auto: true });
}

// Máy mới: lấy kho khoá + dữ liệu từ Drive, rồi mở khoá bằng mật khẩu đã dùng ở máy kia
async function restoreFromDrive() {
  try {
    if (!gdrive.hasValidToken() && gdrive.isStandalone()) toast('Đăng nhập Google xong hãy quay lại app');
    await gdrive.getToken({ action: 'restore' });
    const file = await gdrive.findSyncFile();
    if (!file) return toast('Tài khoản Google này chưa có dữ liệu Coin Manager.');
    const data = await gdrive.downloadSyncFile(file.id);
    if (!store.isBackup(data)) return toast('File trên Google Drive không đúng định dạng của Coin Manager.');
    await store.restoreFresh(data);
    state.settings.googleConnected = true;
    await saveSettings();
    renderTopbar();
    showView('record', { gate: true });
    toast('Đã tải dữ liệu từ Google Drive. Mở khoá bằng mật khẩu bạn dùng ở máy kia.');
  } catch (err) {
    toast(err.message);
  }
}

// ---------- Thông báo ----------

let toastTimer;
function toast(msg, { action, onAction } = {}) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button" class="toast-action">${esc(action)}</button>` : ''}`;
  el.hidden = false;
  el.querySelector('.toast-action')?.addEventListener('click', () => { el.hidden = true; onAction(); }, { once: true });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, action ? 6000 : 3500);
}

init();
