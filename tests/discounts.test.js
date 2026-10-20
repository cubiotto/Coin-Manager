import { extractDiscounts, prepPercent, parseDiscountInput, originalOf, savings, discountedShares } from '../js/discounts.js';
import { parseUtterance, parseAmountInput } from '../js/parser.js';

export function runDiscountTests() {
  const results = [];
  const check = (text, ok, detail = '') => results.push({ text: `[giảm giá] ${text}`, ok: !!ok, detail });
  const run = s => extractDiscounts(parseUtterance(prepPercent(s)).items);
  const J = x => JSON.stringify(x);

  const d1 = run('pizza ba trăm giảm năm mươi');
  check('"pizza ba trăm giảm năm mươi" → trả 250k, giảm 50k', d1.length === 1 && d1[0].name === 'pizza' && d1[0].amount === 250000 && d1[0].discount === 50000, J(d1));
  const d2 = run('trà sữa 60k voucher 20k');
  check('"trà sữa 60k voucher 20k" → trả 40k', d2.length === 1 && d2[0].amount === 40000 && d2[0].discount === 20000, J(d2));
  const d3 = run('áo 400k giảm 20%');
  check('"áo 400k giảm 20%" → giảm 80k, trả 320k', d3.length === 1 && d3[0].discount === 80000 && d3[0].amount === 320000, J(d3));
  const d4 = run('áo bốn trăm nghìn giảm hai mươi phần trăm');
  check('"giảm hai mươi phần trăm" (nói) → giảm 20%', d4.length === 1 && d4[0].discount === 80000, J(d4));
  const d5 = run('phở năm lăm được giảm mười, cà phê hai lăm');
  check('giảm chỉ gắn vào khoản đứng trước', d5.length === 2 && d5[0].amount === 45000 && d5[0].discount === 10000 && !d5[1].discount, J(d5));
  const d6 = run('pizza ba trăm mã giảm giá năm mươi');
  check('"mã giảm giá" cũng được', d6.length === 1 && d6[0].discount === 50000, J(d6));
  const d7 = run('bánh hai mươi giảm ba mươi');
  check('giảm nhiều hơn giá → bỏ qua, giữ nguyên câu', d7.length === 2, J(d7));
  const d8 = run('phở năm lăm cà phê hai lăm');
  check('câu thường không đổi', d8.length === 2 && !d8.some(x => x.discount), J(d8));

  const money = s => parseAmountInput(s);
  check('ô "Được giảm": "50k" → 50.000', parseDiscountInput('50k', 250000, money) === 50000);
  check('ô "Được giảm": "20%" khi đã trả 320k → giảm 80k', parseDiscountInput('20%', 320000, money) === 80000);
  check('ô "Được giảm": trống → 0, sai → null', parseDiscountInput('', 1, money) === 0 && parseDiscountInput('abc', 1, money) === null);
  check('giá gốc = đã trả + giảm', originalOf({ amount: 250000, discount: 50000 }) === 300000);
  const s = savings([{ type: 'expense', amount: 1, discount: 50000 }, { type: 'expense', amount: 1, discount: 30000 }, { type: 'expense', amount: 1 }]);
  check('tiết kiệm nhờ giảm giá: cộng cả tháng', s.total === 80000 && s.count === 2);
  // Chia nhỏ hoá đơn có giảm giá
  const sh = discountedShares([100000, 100000, 100000], 250000, 300000);
  check('siêu thị 300k giảm 50k, chia 100/100/100 → tổng đúng 250k', sh.reduce((s, x) => s + x, 0) === 250000 && sh.every(x => Math.abs(x - 83333) <= 1), J(sh));
  const sh2 = discountedShares([120000, 60000], 250000, 300000);
  check('chia một phần (180k gốc) → 150k đã trả, phần còn lại để cho hoá đơn', J(sh2) === J([100000, 50000]), J(sh2));
  check('không giảm giá → giữ nguyên giá món', J(discountedShares([30000, 20000], 50000, 50000)) === J([30000, 20000]));
  const sh3 = discountedShares([99000, 1000], 80000, 100000);
  check('món nhỏ không bị âm khi dồn phần lẻ', sh3.every(x => x >= 0) && sh3[0] + sh3[1] === 80000, J(sh3));
  return results;
}
