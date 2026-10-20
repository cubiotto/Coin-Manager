import { runParserTests } from './parser.test.js';
import { runVaultTests } from './vault.test.js';
import { runSyncTests } from './sync.test.js';
import { runRecurringTests } from './recurring.test.js';
import { runWalletTests } from './wallets.test.js';
import { runAssetTests } from './assets.test.js';
import { runRefundTests } from './refunds.test.js';
import { runDiscountTests } from './discounts.test.js';

const results = [...runParserTests(), ...runSyncTests(), ...runRecurringTests(), ...runWalletTests(), ...runAssetTests(), ...runRefundTests(), ...runDiscountTests()];
try {
  results.push(...await runVaultTests());
} catch (e) {
  results.push({ text: '[mã hoá] lỗi khi chạy', ok: false, detail: String(e?.stack || e) });
}

const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const pass = results.filter(r => r.ok).length;
document.title = `${pass === results.length ? 'PASS' : 'FAIL'} ${pass}/${results.length}`;
document.getElementById('summary').textContent = document.title;
document.getElementById('out').innerHTML = results
  .map(r => `<tr class="${r.ok ? 'ok' : 'bad'}"><td>${r.ok ? '✓' : '✗'}</td><td>${esc(r.text)}</td><td>${esc(r.detail)}</td></tr>`)
  .join('');
window.__results = results;
