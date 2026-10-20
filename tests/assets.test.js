import { assignAssets, assetBalances, defaultAsset, upsertAsset, parseAliases, matchAsset } from '../js/assets.js';
import { parseUtterance } from '../js/parser.js';
import { buildCategories, classify } from '../js/categories.js';
import { mergeProfile } from '../js/sync.js';
import { dueRecurring } from '../js/recurring.js';

export function runAssetTests() {
  const results = [];
  const check = (text, ok, detail = '') => results.push({ text: `[tài sản] ${text}`, ok: !!ok, detail });
  const a = (id, name, extra = {}) => ({ id, name, icon: '💵', kind: 'cash', aliases: [], opening: 0, order: 0, updatedAt: '2026-10-01T00:00:00Z', ...extra });
  const assets = [
    a('tm', 'Tiền mặt', { aliases: ['tiền mặt', 'cash'], order: 1 }),
    a('vcb', 'Vietcombank', { kind: 'bank', aliases: ['chuyển khoản', 'ck'], order: 2 }),
    a('momo', 'Momo', { kind: 'ewallet', aliases: ['momo', 'ví momo'], order: 3 }),
  ];
  const cats = buildCategories();
  const run = s => assignAssets(parseUtterance(s).items, assets);
  const show = r => JSON.stringify(r.map(i => [i.name, i.amount, i.assetId]));

  // Ví dụ trong yêu cầu: "thịt bò năm mươi nghìn đồng tiền mặt" → Đi chợ & siêu thị 50.000, trừ Tiền mặt
  const r1 = run('thịt bò năm mươi nghìn đồng tiền mặt');
  check('"thịt bò năm mươi nghìn đồng tiền mặt" → Thịt bò 50.000 · Tiền mặt',
    r1.length === 1 && r1[0].name === 'thịt bò' && r1[0].amount === 50000 && r1[0].assetId === 'tm', show(r1));
  check('… và danh mục là Đi chợ & siêu thị', classify(r1[0].name, cats, {}) === 'di-cho', classify(r1[0].name, cats, {}));

  const r2 = run('phở năm lăm');
  check('không nhắc tài sản → để trống (dùng mặc định)', r2[0].assetId === null && r2[0].name === 'phở', show(r2));

  const r3 = run('cà phê hai lăm bằng momo');
  check('"bằng momo" → Momo, bỏ cả chữ "bằng"', r3[0].assetId === 'momo' && r3[0].name === 'cà phê', show(r3));

  const r4 = run('bánh 25 nước ngọt 25 tiền mặt');
  check('cả câu chỉ nhắc một tài sản → mọi khoản dùng tài sản đó', r4.length === 2 && r4.every(i => i.assetId === 'tm')
    && r4[1].name === 'nước ngọt', show(r4));

  const r5 = run('bánh 25 tiền mặt nước ngọt 25 momo');
  check('tài sản đứng đầu khoản sau thuộc khoản trước', r5[0].assetId === 'tm' && r5[1].assetId === 'momo'
    && r5[0].name === 'bánh' && r5[1].name === 'nước ngọt', show(r5));

  const r6 = run('tiền điện năm trăm nghìn chuyển khoản');
  check('"chuyển khoản" → ngân hàng, giữ "tiền điện"', r6[0].assetId === 'vcb' && r6[0].name === 'tiền điện', show(r6));

  const r7 = run('thu lương mười lăm triệu vào vietcombank');
  check('khoản thu "vào vietcombank" → cộng vào Vietcombank', r7[0].assetId === 'vcb' && r7[0].name === 'lương', show(r7));

  const r8 = run('tra sua 30k tien mat');
  check('gõ không dấu "tien mat" vẫn nhận', r8[0].assetId === 'tm' && r8[0].name === 'tra sua', show(r8));

  check('có dấu thì không nhận nhầm từ không dấu', !matchAsset(['trà', 'thẻ'], [a('x', 'The')]));
  check('cụm dài nhất thắng ("ví momo" hơn "momo")', matchAsset(['nạp', 'ví', 'momo'], assets)?.start === 1);
  check('không có tài sản thì không đổi gì', assignAssets([{ name: 'phở tiền mặt', amount: 1 }], [])[0].name === 'phở tiền mặt');

  check('"tiền mặt, Cash; tm" → 3 cách gọi', parseAliases('tiền mặt, Cash; tm').join('|') === 'tiền mặt|cash|tm');

  // Số dư
  const tx = (id, type, amount, assetId, date = '2026-10-05') => ({ id, type, amount, assetId, date });
  const withOpening = [a('tm', 'Tiền mặt', { opening: 500_000 }), a('vcb', 'VCB', { opening: 10_000_000 })];
  const moves = [
    { id: 'm1', kind: 'move', from: 'vcb', to: 'tm', amount: 1_000_000, date: '2026-10-06' },
    { id: 'm2', kind: 'adjust', asset: 'tm', amount: -20_000, date: '2026-10-07' },
    { id: 'm3', kind: 'move', from: 'vcb', to: 'tm', amount: 999, deleted: true },
  ];
  const txs = [tx('1', 'expense', 50_000, 'tm'), tx('2', 'income', 15_000_000, 'vcb'), tx('3', 'expense', 70_000, null),
    tx('4', 'expense', 30_000, 'tm', '2026-09-30')];
  const b = assetBalances(withOpening, moves, txs, '2026-10');
  check('số dư = ban đầu − chi + chuyển vào + điều chỉnh', b.get('tm').balance === 500_000 - 50_000 - 30_000 + 1_000_000 - 20_000,
    b.get('tm').balance);
  check('ngân hàng: + lương − rút ATM', b.get('vcb').balance === 10_000_000 + 15_000_000 - 1_000_000, b.get('vcb').balance);
  check('chi tháng này chỉ tính tháng này', b.get('tm').monthOut === 50_000 && b.get('vcb').monthIn === 15_000_000);
  check('khoản không gắn tài sản không đổi số dư', [...b.values()].every(s => Number.isFinite(s.balance)));
  const credit = assetBalances([a('cc', 'Thẻ', { kind: 'credit', opening: -2_000_000 })], [], [tx('5', 'expense', 500_000, 'cc')], '2026-10');
  check('thẻ tín dụng: chi làm tăng nợ (số âm)', credit.get('cc').balance === -2_500_000);

  // Mặc định
  const now = '2026-10-20T00:00:00Z';
  let list = upsertAsset([], a('tm', 'Tiền mặt', { isDefault: true }), now);
  list = upsertAsset(list, a('vcb', 'VCB', { isDefault: true }), now);
  check('đặt mặc định mới thì bỏ mặc định cũ', defaultAsset(list)?.id === 'vcb' && !list.find(x => x.id === 'tm').isDefault);
  check('tài sản đã xoá không là mặc định', defaultAsset([a('x', 'X', { isDefault: true, deleted: true })]) === null);

  // Đồng bộ
  const p = mergeProfile(
    { assets: [a('tm', 'Tiền mặt', { updatedAt: '2026-10-10T00:00:00Z' })], assetMoves: [moves[0]] },
    { assets: [a('tm', 'Tiền mặt (máy kia)', { updatedAt: '2026-10-12T00:00:00Z' }), a('momo', 'Momo')], assetMoves: [moves[1]] },
  );
  check('đồng bộ: tài sản sửa sau cùng thắng, giữ cả hai máy', p.assets.length === 2 && p.assets.find(x => x.id === 'tm').name === 'Tiền mặt (máy kia)');
  check('đồng bộ: gộp các lần chuyển / điều chỉnh', p.assetMoves.length === 2);

  // Khoản cố định gắn tài sản
  const due = dueRecurring([{ id: 'r', name: 'Netflix', amount: 260_000, day: 1, category: 'giai-tri', active: true, startYm: '2026-10', assetId: 'cc' }],
    () => false, '2026-10-20');
  check('khoản cố định mang theo tài sản', due[0]?.assetId === 'cc', JSON.stringify(due[0]));
  return results;
}
