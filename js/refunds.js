// Chi hộ bạn bè rồi được trả lại: ai nợ bao nhiêu, ai đã hoàn bao nhiêu, về tài sản nào.
// Hàm thuần — app.js lo giao diện và lưu trữ (nằm ngay trong khoản chi, đã mã hoá, đồng bộ cùng khoản).
//
// Trên khoản chi:
//   owes:    [{ id, person, amount }]                          — ai nợ mình bao nhiêu từ khoản này
//   refunds: [{ id, person, amount, assetId?, date, createdAt }] — các lần được trả lại
// Chi thực = số tiền − tổng đã hoàn (thống kê, ví, tổng chi dùng chi thực). Tiền hoàn cộng vào tài sản nhận, không phải khoản thu.
// Người được nhận ra theo tên bỏ danh xưng + bỏ dấu: "anh Lâm", "Lâm", "lam" là một người.

import { normalize, stripAccents } from './categories.js';

// Danh xưng đứng trước tên: "anh Lâm", "chị Hoa", "bạn Minh"
const TITLES = new Set(['anh', 'chị', 'em', 'bạn', 'cô', 'chú', 'bác', 'ông', 'bà', 'thằng', 'con', 'dì', 'cậu', 'mợ', 'thím', 'sếp', 'bé', 'nhỏ']);
// Từ chỉ việc trả lại. "Mạnh": chắc chắn là hoàn tiền. "Yếu" ("trả", "trả tiền"): dễ là khoản chi thường ("trả tiền nhà")
// nên chỉ tính khi người trả có danh xưng hoặc là người đã biết (từng ghi nợ / hoàn).
const STRONG = ['trả lại', 'hoàn lại', 'hoàn tiền', 'hoàn trả', 'gửi lại', 'chuyển lại', 'đưa lại', 'bù lại', 'hoàn'];
const WEAK = ['trả tiền', 'trả nợ', 'trả'];
const VERBS = [...STRONG.map(v => [v, true]), ...WEAK.map(v => [v, false])]
  .map(([v, strong]) => ({ words: v.split(' '), strong })).sort((a, b) => b.words.length - a.words.length);
// Từ thừa quanh tên người / tên khoản. Đại từ ("cho em", "trả mình") chỉ bỏ ở tên khoản — ở tên người thì "anh", "em" là danh xưng.
const FILLER = new Set(['đã', 'vừa', 'mới', 'cũng', 'rồi', 'lại', ',', 'là', 'hết', 'xong']);
const TARGET_FILLER = new Set([...FILLER, 'cho', 'mình', 'tôi', 'tao', 'tớ', 'em', 'anh', 'chị']);
// Từ không mang nghĩa khi so tên khoản chi ("tiền mua game" ~ "mua game")
const STOP = new Set(['tiền', 'cho', 'mình', 'tôi', 'của', 'đã', 'được', 'khoản', 'cái', 'vụ', 'hôm', 'bữa', 'lần', 'đi', 'mua']);

const words = s => normalize(s).split(' ').filter(Boolean);
const plain = s => stripAccents(s);
const capWord = w => w.charAt(0).toUpperCase() + w.slice(1);

/** "anh Lâm" → "lam" (khoá so sánh). */
export function personKey(name) {
  const w = words(name);
  while (w.length > 1 && TITLES.has(w[0])) w.shift();
  return plain(w.join(' '));
}
/** "anh lâm" → "Anh Lâm". */
export const displayPerson = name => words(name).map(capWord).join(' ');

const trimFiller = (w, filler = FILLER) => {
  const out = [...w];
  while (out.length && filler.has(out[0])) out.shift();
  while (out.length && filler.has(out.at(-1))) out.pop();
  return out;
};
const trimTarget = w => trimFiller(w, TARGET_FILLER);

// ---------- Số tiền ----------

export const refundedOf = t => (t.refunds ?? []).reduce((s, r) => s + (r.amount > 0 ? r.amount : 0), 0);
export const netAmount = t => Math.max(0, t.amount - refundedOf(t));

/** Thu nhỏ các phần (món) của khoản theo tỉ lệ chi thực; phần lẻ dồn vào phần lớn nhất để tổng khớp. */
export function netParts(parts, t) {
  const refunded = refundedOf(t);
  if (!refunded || t.type !== 'expense') return parts;
  const net = netAmount(t);
  const ratio = t.amount ? net / t.amount : 0;
  const out = parts.map(p => ({ ...p, amount: Math.round(p.amount * ratio) }));
  const diff = net - out.reduce((s, p) => s + p.amount, 0);
  if (diff && out.length) out.reduce((a, b) => (b.amount > a.amount ? b : a)).amount += diff;
  return out.filter(p => p.amount > 0);
}

/** Ai còn nợ bao nhiêu trên một khoản: Map<key, { name, owed, paid, left }>. */
export function owedOn(t) {
  const out = new Map();
  const get = name => {
    const k = personKey(name);
    if (!out.has(k)) out.set(k, { name: displayPerson(name), owed: 0, paid: 0, left: 0 });
    return out.get(k);
  };
  for (const o of t.owes ?? []) if (o.amount > 0) get(o.person).owed += o.amount;
  for (const r of t.refunds ?? []) if (r.amount > 0) get(r.person).paid += r.amount;
  for (const e of out.values()) e.left = Math.max(0, e.owed - e.paid);
  return out;
}

/** Người khác nợ mình (gộp mọi khoản chi): [{ key, name, left, items: [{ tx, left }] }], nợ nhiều trước. */
export function debtsByPerson(txs) {
  const people = new Map();
  for (const t of txs ?? []) {
    if (t.type !== 'expense' || !t.owes?.length) continue;
    for (const [key, e] of owedOn(t)) {
      if (!(e.left > 0)) continue;
      const p = people.get(key) ?? { key, name: e.name, left: 0, items: [] };
      p.left += e.left;
      p.items.push({ tx: t, left: e.left });
      people.set(key, p);
    }
  }
  for (const p of people.values()) p.items.sort((a, b) => a.tx.date.localeCompare(b.tx.date));
  return [...people.values()].sort((a, b) => b.left - a.left || a.name.localeCompare(b.name, 'vi'));
}

/** Mọi người đã từng ghi nợ / hoàn (khoá) — để nhận ra "lâm trả 250" dù không có danh xưng. */
export function knownPeople(txs) {
  const out = new Set();
  for (const t of txs ?? []) for (const x of [...(t.owes ?? []), ...(t.refunds ?? [])]) out.add(personKey(x.person));
  return out;
}

/** Trả nợ cho một người: chia số tiền vào các khoản người đó còn nợ, khoản cũ trước. Dư thì trả về `extra`. */
export function planRepayment(txs, key, amount) {
  const debt = debtsByPerson(txs).find(p => p.key === key);
  const plan = [];
  let rest = amount;
  for (const it of debt?.items ?? []) {
    if (rest <= 0) break;
    const take = Math.min(rest, it.left);
    plan.push({ tx: it.tx, amount: take });
    rest -= take;
  }
  return { plan, extra: rest };
}

// ---------- Nhận ra trong câu nói ----------

function findVerb(w) {
  for (let i = 0; i < w.length; i++) {
    for (const v of VERBS) if (v.words.every((x, k) => w[i + k] === x)) return { start: i, end: i + v.words.length, strong: v.strong };
  }
  return null;
}

const personOk = (p, { strong, viaDuoc, known, strict }) => p.length >= 1 && p.length <= 4
  && (!strict || strong || viaDuoc || TITLES.has(p[0]) || !!known?.has(personKey(p.join(' '))));

/**
 * Câu hoàn tiền? (tên khoản đã tách số tiền + tài sản)
 *  "tiền mua game đã được anh lâm trả lại" → { person: 'Anh Lâm', target: 'tiền mua game' }
 *  "anh lâm trả lại tiền lẩu"               → { person: 'Anh Lâm', target: 'tiền lẩu' }
 *  "lâm trả" (Lâm đã ghi nợ trước đó)       → { person: 'Lâm', target: '' }
 *  "hoàn tiền vé xem phim từ chị hoa"       → { person: 'Chị Hoa', target: 'vé xem phim' }
 * strict=false (đang khoá, chưa biết ai từng nợ): nhận cả "lâm trả" không danh xưng.
 * @returns {{ person, target } | null}
 */
export function detectRefund(name, { known, strict = true } = {}) {
  const w = words(name);
  const v = findVerb(w);
  if (!v) return null;
  const before = w.slice(0, v.start);
  const after = w.slice(v.end);
  let person;
  let target;
  let viaDuoc = false;
  const duoc = before.lastIndexOf('được');
  if (duoc >= 0) {                       // "<khoản> đã được <người> trả lại"
    viaDuoc = true;
    person = trimFiller(before.slice(duoc + 1));
    target = [...before.slice(0, duoc), ...after];
  } else if (trimFiller(before).length) { // "<người> trả lại <khoản>"
    person = trimFiller(before);
    target = after;
  } else {                               // "hoàn tiền <khoản> từ <người>"
    const tu = after.lastIndexOf('từ');
    if (tu < 0) return null;
    person = trimFiller(after.slice(tu + 1));
    target = after.slice(0, tu);
  }
  if (!personOk(person, { strong: v.strong, viaDuoc, known, strict })) return null;
  return { person: displayPerson(person.join(' ')), target: trimTarget(target).join(' ') };
}

/**
 * Ghi nợ cho khoản đã có (câu không có khoản chi đứng trước):
 *  "lâm nợ tiền lẩu" → { person: 'Lâm', target: 'tiền lẩu' } · "anh lâm nợ" → { person: 'Anh Lâm', target: '' }
 * Không nhận "trả nợ thẻ" (đó là khoản chi). Người không danh xưng, chưa biết, không nói tên khoản → null.
 */
export function detectOwe(name, { known } = {}) {
  const w = words(name);
  const i = w.indexOf('nợ');
  if (i < 1 || i > 5 || ['trả', 'vay', 'lãi', 'khoản'].includes(w[i - 1])) return null;
  const person = trimFiller(w.slice(0, i).filter(x => x !== 'còn'));
  const target = trimTarget(w.slice(i + 1));
  if (!person.length || person.length > 4) return null;
  if (!target.length && !TITLES.has(person[0]) && !known?.has(personKey(person.join(' ')))) return null;
  return { person: displayPerson(person.join(' ')), target: target.join(' ') };
}

const OWE_ITEM = /^(.{1,40}?)\s+(?:còn\s+)?nợ(?:\s+(?:mình|tôi|tao|tớ|em|anh|chị|lại))?$/u;
const SPLIT = /\s*,?\s*chia\s+(đôi|ba|bốn|năm|đều)\s+(?:với|cùng|cho)\s+(.+)$/u;
const SPLIT_N = { 'đôi': 2, 'ba': 3, 'bốn': 4, 'năm': 5 };

/**
 * Ghi nợ ngay lúc chi, trong cùng câu nói (các khoản đã tách từ parseUtterance):
 *  "lẩu năm trăm lâm nợ hai trăm rưỡi"   → Lẩu 500k, owes: [Lâm 250k]
 *  "lẩu năm trăm chia đôi với lâm"         → Lẩu 500k, owes: [Lâm 250k]
 *  "pizza 300 chia đều với lâm và hùng"    → owes: [Lâm 100k, Hùng 100k]
 * Khoản "X nợ …" đứng đầu câu (không có khoản trước) giữ nguyên để app xử lý như ghi nợ cho khoản cũ.
 */
export function extractOwes(items, newId = () => crypto.randomUUID()) {
  const out = [];
  for (const it of items) {
    const name = normalize(it.name);
    const m = name.match(OWE_ITEM);
    const prev = out.at(-1);
    if (m && prev && !/(^|\s)(trả|vay|lãi)$/u.test(m[1])) {
      const person = trimFiller(m[1].split(' '));
      if (person.length && person.length <= 4) {
        prev.owes = [...(prev.owes ?? []), { id: newId(), person: displayPerson(person.join(' ')), amount: it.amount }];
        continue;
      }
    }
    const s = it.name.match(SPLIT);
    if (s) {
      // (\b không dùng được với chữ có dấu như "và" → tách theo khoảng trắng)
      const people = s[2].split(/\s*,\s*|\s+(?:và|với)\s+/u).map(x => trimFiller(x.split(' ').filter(Boolean))).filter(p => p.length && p.length <= 4);
      const n = SPLIT_N[s[1]] ?? people.length + 1;
      if (people.length && n > people.length) {
        const share = Math.round(it.amount / n);
        out.push({ ...it, name: it.name.slice(0, s.index).trim(), owes: people.map(p => ({ id: newId(), person: displayPerson(p.join(' ')), amount: share })) });
        continue;
      }
    }
    out.push({ ...it });
  }
  return out;
}

// ---------- Tìm khoản chi được hoàn ----------

const DAY = 86_400_000;
const tokens = s => new Set(words(s).map(plain).filter(x => !STOP.has(x) && x.length > 1));

/**
 * Các khoản chi có thể là khoản được hoàn / ghi nợ, hợp nhất trước.
 * Ưu tiên: người đó đang nợ ở khoản này (đúng số tiền càng tốt) > tên giống > gần đây.
 * kind 'refund': chỉ khoản còn đủ tiền chưa hoàn. @returns [{ tx, score, owesLeft, sure }]
 */
export function matchTargets({ target = '', person, amount, kind = 'refund' }, txs, todayIso) {
  const key = person ? personKey(person) : null;
  const want = tokens(target);
  const now = Date.parse(todayIso);
  const out = [];
  for (const t of txs ?? []) {
    if (t.type !== 'expense' || t.deleted) continue;
    if (kind === 'refund' && netAmount(t) < amount) continue;
    const have = tokens([t.name, ...(t.splits ?? []).map(s => s.name)].join(' '));
    const hit = [...want].filter(x => have.has(x)).length;
    const nameScore = want.size ? hit / want.size : 0;
    const owesLeft = key ? owedOn(t).get(key)?.left ?? 0 : 0;
    if (want.size && !hit && !owesLeft) continue;
    const age = Math.max(0, (now - Date.parse(t.date)) / DAY);
    const score = nameScore * 3 + (owesLeft > 0 ? 2 : 0) + (owesLeft === amount ? 1 : 0) - Math.min(age / 60, 1.5);
    out.push({ tx: t, score, owesLeft, sure: nameScore >= 0.5 || owesLeft > 0 });
  }
  return out.sort((a, b) => b.score - a.score || b.tx.date.localeCompare(a.tx.date));
}

/** Tổng người khác còn nợ trên một khoản. */
export const debtLeft = t => [...owedOn(t).values()].reduce((s, e) => s + e.left, 0);

/** Khoản chi gần đây để chọn tay (khi không khớp tên): khoản ai đó còn nợ trước, rồi mới nhất. */
export function recentExpenses(txs, amount, limit = 12) {
  return (txs ?? []).filter(t => t.type === 'expense' && netAmount(t) >= (amount || 0))
    .sort((a, b) => (debtLeft(b) > 0) - (debtLeft(a) > 0) || b.date.localeCompare(a.date) || (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
    .slice(0, limit);
}
