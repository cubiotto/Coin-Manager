// Khoản cố định hằng tháng (Netflix, phí giữ xe, tiền nhà...). Hàm thuần — không đụng tới lưu trữ.
//
// Không có máy chủ nên app "ghi bù" khi được mở: mọi tháng từ startYm tới nay mà đã tới ngày trừ thì tạo khoản.
// Mỗi khoản tự sinh có id cố định `rec-<quy tắc>-<YYYY-MM>` → hai máy cùng sinh vẫn chỉ là một khoản khi đồng bộ,
// và khoản bạn đã xoá (có dấu xoá cùng id) không bị tạo lại.

const pad = n => String(n).padStart(2, '0');
export const ymOf = iso => iso.slice(0, 7);
export function nextYm(ym) {
  const [y, m] = ym.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`;
}
/** Ngày trừ của một tháng; ngày 31 ở tháng ngắn → ngày cuối tháng. */
export function dueDate(ym, day) {
  const [y, m] = ym.split('-').map(Number);
  return `${ym}-${pad(Math.min(day, new Date(y, m, 0).getDate()))}`;
}
export const recurringTxId = (ruleId, ym) => `rec-${ruleId}-${ym}`;

/** Tháng bắt đầu khi bật/thêm quy tắc mà không muốn ghi bù: còn kịp tháng này thì tháng này, không thì tháng sau. */
export const startYmFor = (day, todayIso) => (day >= Number(todayIso.slice(8)) ? ymOf(todayIso) : nextYm(ymOf(todayIso)));

export const activeRules = rules => (rules ?? []).filter(r => !r.deleted);

/** Các khoản cần tạo tính đến hôm nay. hasId(id) = khoản (hoặc dấu xoá) đã có chưa. */
export function dueRecurring(rules, hasId, todayIso, now = new Date().toISOString()) {
  const out = [];
  const current = ymOf(todayIso);
  for (const r of activeRules(rules)) {
    if (!r.active || !/^\d{4}-\d{2}$/.test(r.startYm ?? '') || !(r.amount > 0) || !(r.day >= 1 && r.day <= 31)) continue;
    for (let ym = r.startYm; ym <= current; ym = nextYm(ym)) {
      const date = dueDate(ym, r.day);
      if (date > todayIso) break;
      const id = recurringTxId(r.id, ym);
      if (hasId(id)) continue;
      out.push({
        id, date, name: r.name, amount: r.amount, category: r.category, type: r.type ?? 'expense',
        raw: 'Khoản cố định hằng tháng', recurringId: r.id, ...(r.assetId ? { assetId: r.assetId } : {}), createdAt: now, updatedAt: now,
      });
    }
  }
  return out;
}

/** Lần trừ kế tiếp (để hiển thị). */
export function nextDue(rule, todayIso) {
  const current = ymOf(todayIso);
  if (rule.startYm > current) return dueDate(rule.startYm, rule.day);
  const thisMonth = dueDate(current, rule.day);
  return thisMonth > todayIso ? thisMonth : dueDate(nextYm(current), rule.day);
}
