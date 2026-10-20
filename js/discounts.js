// Giảm giá / voucher / khuyến mãi. Hàm thuần.
//
// Số tiền của khoản luôn là số ĐÃ TRẢ THẬT (thống kê, ví, tài sản dùng số này). Khoản được giảm lưu thêm:
//   discount: số tiền được giảm  → giá gốc = amount + discount
// Nói: "pizza ba trăm giảm năm mươi" / "trà sữa 60k voucher 20k" / "áo 400k giảm 20%" — số đứng trước là GIÁ GỐC.

import { normalize } from './categories.js';

export const originalOf = t => t.amount + (t.discount > 0 ? t.discount : 0);
export const discountOf = t => (t.discount > 0 ? t.discount : 0);

// Tên "khoản" chỉ là lời giảm giá: "giảm", "được giảm", "voucher", "mã giảm giá", "khuyến mãi", "sale"…
const DISCOUNT_NAME = new RegExp('^(?:được |có |dùng |áp |trừ |xài )?(?:giảm(?: giá)?|voucher|vâu chơ|vao chơ|coupon|mã(?: giảm(?: giá)?)?'
  + '|khuyến mãi|sale|chiết khấu|ưu đãi|bớt)(?: (?:được|còn|hết|thêm|nữa))?$', 'u');

/** Câu nói có "phần trăm" → "%" để bộ phân tích tách được: "giảm hai mươi phần trăm" → "giảm hai mươi %". */
export const prepPercent = text => String(text ?? '').replace(/\s*phần\s+trăm/giu, ' %');

/**
 * Gắn giảm giá vào khoản đứng trước trong cùng câu (các khoản đã tách từ parseUtterance):
 *  "pizza ba trăm giảm năm mươi" → [{ name: 'pizza', amount: 250000, discount: 50000 }]
 *  "áo 400k giảm 20%"            → [{ name: 'áo', amount: 320000, discount: 80000 }]
 * Giảm ≥ giá gốc thì bỏ qua (giữ nguyên câu).
 */
export function extractDiscounts(items) {
  const out = [];
  for (const it of items) {
    const raw = String(it.name ?? '');
    const pct = raw.includes('%');
    const name = normalize(raw.replace(/%/g, ' '));
    const prev = out.at(-1);
    if (prev && DISCOUNT_NAME.test(name)) {
      const original = prev.amount + (prev.discount ?? 0);
      // "20%": bộ phân tích hiểu 20 là 20.000đ (số < 1000 là nghìn) → lấy lại 20
      const p = pct ? (it.amount >= 1000 ? it.amount / 1000 : it.amount) : 0;
      const off = pct ? Math.round((original * p) / 100) : it.amount;
      if ((!pct || (p > 0 && p < 100)) && off > 0 && off < original) {
        const discount = (prev.discount ?? 0) + off;
        out[out.length - 1] = { ...prev, amount: original - discount, discount };
        continue;
      }
    }
    out.push({ ...it });
  }
  return out;
}

/**
 * Ô "Được giảm" trong Sửa khoản (số tiền khoản = đã trả): "50k" → 50.000 · "20%" → 20% của giá gốc
 * (giá gốc = đã trả / (1 − 20%)). Trống → 0. Sai → null.
 */
export function parseDiscountInput(text, paid, parseMoney) {
  const s = String(text ?? '').trim();
  if (!s || /^0+$/.test(s)) return 0;
  const m = s.match(/^(\d+(?:[.,]\d+)?)\s*%$/);
  if (m) {
    const p = Number(m[1].replace(',', '.'));
    return p > 0 && p < 100 && paid > 0 ? Math.round((paid * p) / (100 - p)) : null;
  }
  const v = parseMoney(s);
  return v > 0 ? v : null;
}

/** Tổng được giảm trong danh sách khoản: { total, count }. */
export function savings(txs) {
  let total = 0;
  let count = 0;
  for (const t of txs ?? []) {
    if (t.type === 'expense' && t.discount > 0) {
      total += t.discount;
      count += 1;
    }
  }
  return { total, count };
}
