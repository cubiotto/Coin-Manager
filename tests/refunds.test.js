import {
  detectRefund, detectOwe, extractOwes, matchTargets, netAmount, netParts, owedOn, debtsByPerson, planRepayment,
  knownPeople, personKey, recentExpenses,
} from '../js/refunds.js';
import { parseUtterance } from '../js/parser.js';
import { assetBalances } from '../js/assets.js';

export function runRefundTests() {
  const results = [];
  const check = (text, ok, detail = '') => results.push({ text: `[hoàn tiền] ${text}`, ok: !!ok, detail });
  const one = s => parseUtterance(s).items[0];
  const J = x => JSON.stringify(x);

  // Câu trong yêu cầu
  const it = one('Tiền mua game đã được anh Lâm trả lại 257k');
  const r1 = detectRefund(it.name);
  check('"Tiền mua game đã được anh Lâm trả lại 257k" → Anh Lâm · 257k · tiền mua game',
    it.amount === 257000 && r1?.person === 'Anh Lâm' && r1.target === 'tiền mua game', J([it, r1]));

  const r2 = detectRefund(one('anh lâm trả lại tiền lẩu hai trăm rưỡi').name);
  check('"anh lâm trả lại tiền lẩu …" → người trước, khoản sau', r2?.person === 'Anh Lâm' && r2.target === 'tiền lẩu', J(r2));
  const r3 = detectRefund(one('hoàn tiền vé xem phim từ chị hoa 120k').name);
  check('"hoàn tiền vé xem phim từ chị hoa" → Chị Hoa', r3?.person === 'Chị Hoa' && r3.target === 'vé xem phim', J(r3));
  const r4 = detectRefund(one('minh gửi lại tiền taxi 80k').name);
  check('"minh gửi lại" (từ mạnh) nhận cả khi không có danh xưng', r4?.person === 'Minh' && r4.target === 'tiền taxi', J(r4));

  // "trả" (từ yếu) dễ là khoản chi thường
  check('"trả tiền nhà ba triệu" vẫn là khoản chi', detectRefund(one('trả tiền nhà ba triệu').name) === null);
  check('"mẹ trả tiền điện 500k" (chưa biết "mẹ") vẫn là khoản chi', detectRefund(one('mẹ trả tiền điện 500k').name) === null);
  check('"trả góp điện thoại 2 triệu" vẫn là khoản chi', detectRefund(one('trả góp điện thoại 2 triệu').name) === null);
  const known = new Set(['lam']);
  const r5 = detectRefund(one('lâm trả 250k').name, { known });
  check('"lâm trả 250k" khi Lâm đã từng nợ → hoàn tiền, chưa rõ khoản', r5?.person === 'Lâm' && r5.target === '', J(r5));
  check('"lâm trả 250k" khi chưa biết Lâm → khoản chi thường', detectRefund(one('lâm trả 250k').name) === null);
  check('đang khoá (strict=false) thì nhận cả "lâm trả"', detectRefund('lâm trả', { strict: false })?.person === 'Lâm');

  // Ghi nợ lúc chi
  let n = 0;
  const id = () => `o${++n}`;
  const o1 = extractOwes(parseUtterance('lẩu năm trăm lâm nợ hai trăm rưỡi').items, id);
  check('"lẩu năm trăm lâm nợ hai trăm rưỡi" → Lẩu 500k, Lâm nợ 250k',
    o1.length === 1 && o1[0].name === 'lẩu' && o1[0].amount === 500000 && o1[0].owes?.[0]?.person === 'Lâm' && o1[0].owes[0].amount === 250000, J(o1));
  const o2 = extractOwes(parseUtterance('lẩu năm trăm chia đôi với anh lâm').items, id);
  check('"chia đôi với anh lâm" → Anh Lâm nợ một nửa', o2[0].name === 'lẩu' && o2[0].owes?.[0]?.person === 'Anh Lâm' && o2[0].owes[0].amount === 250000, J(o2));
  const o3 = extractOwes(parseUtterance('pizza ba trăm chia đều với lâm và hùng').items, id);
  check('"chia đều với lâm và hùng" → mỗi người 100k', o3[0].owes?.length === 2 && o3[0].owes.every(o => o.amount === 100000)
    && o3[0].owes.map(o => o.person).join() === 'Lâm,Hùng', J(o3));
  const o4 = extractOwes(parseUtterance('trả nợ thẻ tín dụng hai triệu').items, id);
  check('"trả nợ thẻ tín dụng" không phải ai nợ mình', !o4[0].owes && o4[0].name === 'trả nợ thẻ tín dụng', J(o4));
  const o5 = extractOwes(parseUtterance('phở năm lăm cà phê hai lăm').items, id);
  check('câu thường không đổi', o5.length === 2 && !o5.some(x => x.owes), J(o5));

  check('"lâm nợ tiền lẩu" → ghi nợ cho khoản cũ', J(detectOwe('lâm nợ tiền lẩu')) === J({ person: 'Lâm', target: 'tiền lẩu' }));
  check('"trả nợ ngân hàng" không phải ghi nợ', detectOwe('trả nợ ngân hàng') === null);

  // Người: "anh Lâm" = "Lâm" = "lam"
  check('"anh Lâm", "Lâm", "lam" là một người', personKey('anh Lâm') === personKey('Lâm') && personKey('lam') === personKey('Lâm'));

  // Số tiền, chi thực
  const game = { id: 'g', type: 'expense', name: 'Tiền mua game', amount: 500000, date: '2026-10-15', category: 'giai-tri', assetId: 'tm',
    owes: [{ id: 'x', person: 'Lâm', amount: 257000 }], refunds: [] };
  check('chưa hoàn: chi thực = 500k', netAmount(game) === 500000);
  const paid = { ...game, refunds: [{ id: 'r', person: 'anh Lâm', amount: 257000, assetId: 'vcb', date: '2026-10-20' }] };
  check('hoàn 257k: chi thực = 243k', netAmount(paid) === 243000);
  check('hoàn xong: Lâm không còn nợ', owedOn(paid).get('lam').left === 0 && owedOn(game).get('lam').left === 257000);
  const parts = netParts([{ name: 'A', amount: 300000, category: 'x' }, { name: 'B', amount: 200000, category: 'y' }], paid);
  check('hoá đơn đã chia: các món thu nhỏ theo tỉ lệ, tổng = chi thực', parts.reduce((s, p) => s + p.amount, 0) === 243000, J(parts));

  const bal = assetBalances([{ id: 'tm', name: 'TM', opening: 1000000 }, { id: 'vcb', name: 'VCB', opening: 0 }], [], [paid], '2026-10');
  check('tài sản: trả bằng Tiền mặt −500k, hoàn về VCB +257k', bal.get('tm').balance === 500000 && bal.get('vcb').balance === 257000);

  // Tìm khoản được hoàn
  const lau = { id: 'l', type: 'expense', name: 'Lẩu', amount: 600000, date: '2026-10-18', category: 'an-uong', owes: [{ id: 'y', person: 'Lâm', amount: 200000 }] };
  const pho = { id: 'p', type: 'expense', name: 'Phở', amount: 55000, date: '2026-10-19', category: 'an-uong' };
  const txs = [game, lau, pho];
  const m1 = matchTargets({ target: 'tiền mua game', person: 'Anh Lâm', amount: 257000 }, txs, '2026-10-20');
  check('khớp "tiền mua game" → Tiền mua game', m1[0]?.tx.id === 'g' && m1[0].sure, J(m1.map(x => [x.tx.id, x.score])));
  const m2 = matchTargets({ target: '', person: 'Lâm', amount: 200000 }, txs, '2026-10-20');
  check('"Lâm trả 200k" không nói khoản → khoản Lâm nợ đúng 200k', m2[0]?.tx.id === 'l' && m2[0].sure, J(m2.map(x => [x.tx.id, x.score])));
  const m3 = matchTargets({ target: 'phở', person: 'Lâm', amount: 100000 }, txs, '2026-10-20');
  check('không khớp khoản nào còn đủ tiền → không chắc', !m3.some(x => x.tx.id === 'p'), J(m3.map(x => x.tx.id)));
  check('danh sách chọn tay: khoản đang có người nợ đứng trước', recentExpenses(txs, 0)[0].owes?.length > 0);

  // Ai nợ mình
  const debts = debtsByPerson(txs);
  check('thẻ "Người khác nợ bạn": Lâm nợ 457k ở 2 khoản', debts.length === 1 && debts[0].left === 457000 && debts[0].items.length === 2, J(debts.map(d => [d.name, d.left])));
  const plan = planRepayment(txs, 'lam', 300000);
  check('Lâm trả 300k → trả khoản cũ trước (game 257k, lẩu 43k)', plan.plan.length === 2 && plan.plan[0].tx.id === 'g'
    && plan.plan[0].amount === 257000 && plan.plan[1].amount === 43000 && plan.extra === 0, J(plan.plan.map(p => [p.tx.id, p.amount])));
  check('trả dư → phần dư báo lại', planRepayment(txs, 'lam', 500000).extra === 43000);
  check('biết những ai từng nợ', knownPeople(txs).has('lam'));
  return results;
}
