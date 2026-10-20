// Tài sản: nơi tiền thật nằm — tiền mặt, ngân hàng, ví điện tử, thẻ tín dụng…
// Khác với Ví (chia hũ, ngân sách ảo theo danh mục): một khoản chi vừa trừ ví theo danh mục, vừa trừ tài sản đã trả.
// Hàm thuần — app.js lo giao diện và lưu trữ (tài sản + các lần chuyển / điều chỉnh nằm trong hồ sơ đã mã hoá).
//
// Tài sản:   { id, name, icon, kind, tint, aliases: [cách gọi khác], opening, isDefault, order, updatedAt, deleted? }
//            opening = số dư lúc bắt đầu theo dõi. Thẻ tín dụng: số dư âm = đang nợ.
// Biến động: { id, date, kind: 'move' | 'adjust', from?, to?, asset?, amount, createdAt, updatedAt, deleted? }
//            move   = chuyển `amount` từ `from` sang `to` (rút ATM, nạp Momo, trả thẻ) — không phải thu/chi
//            adjust = cộng `amount` (âm hoặc dương) vào `asset` khi số dư thật bị lệch
// Khoản thu/chi có assetId → số dư = opening + thu − chi + tiền bạn bè hoàn lại ± chuyển ± điều chỉnh. Khoản cũ không có assetId thì không tính.

import { normalize, stripAccents } from './categories.js';

export const ASSET_KINDS = {
  cash: { label: 'Tiền mặt', icon: '💵' },
  bank: { label: 'Ngân hàng', icon: '🏦' },
  ewallet: { label: 'Ví điện tử', icon: '📱' },
  credit: { label: 'Thẻ tín dụng', icon: '💳' },
  other: { label: 'Khác', icon: '💰' },
};
export const ASSET_ICONS = ['💵', '🏦', '📱', '💳', '💰', '🐷', '🪙', '🏧', '💼', '👛', '🌐', '🎁'];
const TINTS = [2, 5, 10, 4, 8, 3, 6, 11, 7, 13, 0, 9, 1, 12];

// Gợi ý khi thêm tài sản; "Gọi khác" là các từ bạn hay nói khi trả bằng tài sản đó
export const ASSET_SUGGEST = [
  { name: 'Tiền mặt', kind: 'cash', icon: '💵', aliases: ['tiền mặt', 'cash'] },
  { name: 'Ngân hàng', kind: 'bank', icon: '🏦', aliases: ['chuyển khoản', 'ck', 'ngân hàng', 'thẻ atm'] },
  { name: 'Momo', kind: 'ewallet', icon: '📱', aliases: ['momo', 'mô mô', 'ví momo'] },
  { name: 'ZaloPay', kind: 'ewallet', icon: '📱', aliases: ['zalopay', 'zalo pay'] },
  { name: 'ShopeePay', kind: 'ewallet', icon: '📱', aliases: ['shopeepay', 'shopee pay'] },
  { name: 'Thẻ tín dụng', kind: 'credit', icon: '💳', aliases: ['thẻ tín dụng', 'quẹt thẻ', 'credit'] },
];

// Từ đi kèm tên tài sản, bỏ cùng khi tách khỏi tên khoản: "trả bằng tiền mặt", "thanh toán qua momo"
const PAY_WORDS = new Set(['bằng', 'qua', 'trả', 'dùng', 'từ', 'vào', 'thanh', 'toán', 'quẹt']);
const EDGE_WORDS = new Set([',', 'và', 'với', 'rồi']);

export const liveAssets = assets => (assets ?? []).filter(a => !a.deleted)
  .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name, 'vi'));
export const liveMoves = (moves, assets) => {
  const ids = new Set(liveAssets(assets).map(a => a.id));
  return (moves ?? []).filter(m => !m.deleted && Number.isFinite(m.amount)
    && (m.kind === 'move' ? ids.has(m.from) || ids.has(m.to) : m.kind === 'adjust' && ids.has(m.asset)));
};

export const nextAssetTint = assets => TINTS[liveAssets(assets).length % TINTS.length];
export const nextAssetOrder = assets => Math.max(0, ...(assets ?? []).map(a => a.order ?? 0)) + 1;

/** Tài sản mặc định (khi câu nói không nhắc tài sản nào). Hai máy cùng đặt thì bản sửa sau cùng thắng. */
export function defaultAsset(assets) {
  const live = liveAssets(assets);
  return live.filter(a => a.isDefault).sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))[0] ?? null;
}

/** Thêm / sửa một tài sản. Đặt làm mặc định thì bỏ mặc định ở tài sản khác. */
export function upsertAsset(assets, a, now) {
  const others = (assets ?? []).filter(x => x.id !== a.id).map(x =>
    (a.isDefault && x.isDefault && !x.deleted ? { ...x, isDefault: false, updatedAt: now } : x));
  return [...others, { ...a, updatedAt: now }];
}

/** "tiền mặt, cash; TM" → ['tiền mặt', 'cash', 'tm'] (bỏ trùng, bỏ rỗng). */
export function parseAliases(text) {
  return [...new Set(String(text ?? '').split(/[,;\n]/).map(normalize).filter(Boolean))];
}

const plain = s => stripAccents(s);
const hasAccent = s => plain(s) !== s;

/**
 * Tìm tài sản được nhắc trong một dãy từ (đã viết thường). Cụm dài nhất thắng.
 * Gõ không dấu ("tien mat") cũng nhận, nhưng chỉ khi cả câu không có dấu (tránh "the" ≠ "thẻ").
 * @returns {{ asset, start, end } | null}
 */
export function matchAsset(words, assets) {
  const norm = words.map(w => normalize(w));
  const noAccents = !norm.some(hasAccent);
  const cand = noAccents ? norm.map(plain) : norm;
  let best = null;
  for (const a of liveAssets(assets)) {
    for (const alias of new Set([normalize(a.name), ...(a.aliases ?? []).map(normalize)])) {
      if (!alias) continue;
      const aw = alias.split(' ');
      const cmp = noAccents ? aw.map(plain) : aw;
      for (let s = 0; s + aw.length <= cand.length; s++) {
        if (!cmp.every((w, k) => cand[s + k] === w)) continue;
        if (!best || aw.length > best.end - best.start) best = { asset: a, start: s, end: s + aw.length };
        break;
      }
    }
  }
  return best;
}

// Bỏ tên tài sản + từ đi kèm ngay trước nó ("bằng", "qua"…), dọn dấu phẩy / từ nối ở hai đầu
function stripMatch(words, start, end) {
  let s = start;
  while (s > 0 && PAY_WORDS.has(normalize(words[s - 1]))) s--;
  const w = [...words.slice(0, s), ...words.slice(end)];
  while (w.length && EDGE_WORDS.has(w[0])) w.shift();
  while (w.length && (EDGE_WORDS.has(w.at(-1)) || PAY_WORDS.has(normalize(w.at(-1))))) w.pop();
  return w.join(' ');
}

/**
 * Gắn tài sản cho các khoản trong MỘT câu nói và bỏ tên tài sản khỏi tên khoản.
 *  - "thịt bò năm mươi nghìn tiền mặt" → { name: 'thịt bò', assetId: <Tiền mặt> }
 *  - Tên tài sản đứng ngay đầu khoản sau thì thuộc khoản trước: "bánh 25 tiền mặt nước 25 momo"
 *  - Cả câu chỉ nhắc một tài sản → mọi khoản trong câu dùng tài sản đó ("bánh 25 nước 25 tiền mặt")
 * Khoản không nhắc tài sản nào: assetId = null (app dùng tài sản mặc định).
 */
export function assignAssets(items, assets) {
  const out = items.map(it => ({ ...it, assetId: null }));
  if (!liveAssets(assets).length) return out;
  out.forEach((it, k) => {
    // Một khoản có thể chứa hai tài sản: "tiền mặt nước ngọt 25 momo" (của khoản trước + của chính nó)
    for (let guard = 0; guard < 4; guard++) {
      const words = String(it.name ?? '').split(' ').filter(Boolean);
      const m = matchAsset(words, assets);
      if (!m) break;
      const atStart = words.slice(0, m.start).every(w => PAY_WORDS.has(normalize(w)) || EDGE_WORDS.has(w));
      const target = atStart && k > 0 && !out[k - 1].assetId && m.end < words.length ? out[k - 1] : it;
      target.assetId ??= m.asset.id;
      it.name = stripMatch(words, m.start, m.end);
    }
  });
  const found = new Set(out.map(it => it.assetId).filter(Boolean));
  if (found.size === 1) {
    const [only] = found;
    out.forEach(it => { it.assetId ??= only; });
  }
  return out;
}

/**
 * Số dư từng tài sản. txs: khoản thu/chi (đã bỏ dấu xoá). ym: tháng để tính thu/chi trong tháng.
 * @returns {Map<id, { balance, monthIn, monthOut }>}
 */
export function assetBalances(assets, moves, txs, ym) {
  const out = new Map(liveAssets(assets).map(a => [a.id, { balance: Number(a.opening) || 0, monthIn: 0, monthOut: 0 }]));
  const add = (id, amt) => { const s = out.get(id); if (s) s.balance += amt; return s; };
  for (const t of txs ?? []) {
    if (!t.assetId || !(t.amount > 0)) continue;
    const s = add(t.assetId, t.type === 'income' ? t.amount : -t.amount);
    if (s && t.date?.startsWith(ym)) t.type === 'income' ? (s.monthIn += t.amount) : (s.monthOut += t.amount);
  }
  // Bạn bè trả lại tiền chi hộ: cộng vào tài sản nhận (không phải khoản thu)
  for (const t of txs ?? []) for (const r of t.refunds ?? []) if (r.assetId && r.amount > 0) add(r.assetId, r.amount);
  for (const m of liveMoves(moves, assets)) {
    if (m.kind === 'move') {
      add(m.from, -m.amount);
      add(m.to, m.amount);
    } else {
      add(m.asset, m.amount);
    }
  }
  return out;
}
