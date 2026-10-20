// Gộp dữ liệu giữa các thiết bị (hàm thuần, không đụng tới mạng hay IndexedDB).
//
// Mỗi khoản có updatedAt. Khoản bị xoá để lại "dấu xoá" { id, deleted: true, updatedAt } — nếu không,
// khoản đã xoá ở máy này sẽ sống lại khi gộp dữ liệu từ máy kia.
// Luật: cùng id thì bản nào sửa sau cùng thắng (dấu xoá cũng là một lần sửa).

export const stamp = t => Date.parse(t?.updatedAt || t?.createdAt || 0) || 0;
export const isTomb = t => t?.deleted === true && typeof t.id === 'string' && stamp(t) > 0;

/**
 * @returns {{ rows: object[], pulledIds: Set<string>, pushed: number }}
 *   rows: kết quả gộp · pulledIds: các id lấy từ bên kia (cần ghi xuống máy này) · pushed: số khoản bên kia thiếu/cũ hơn
 */
export function mergeRows(local, remote) {
  const out = new Map(local.map(t => [t.id, t]));
  const remoteById = new Map(remote.map(t => [t.id, t]));
  const pulledIds = new Set();
  for (const r of remote) {
    const l = out.get(r.id);
    if (!l || stamp(r) > stamp(l)) {
      out.set(r.id, r);
      pulledIds.add(r.id);
    }
  }
  const pushed = local.filter(l => !remoteById.has(l.id) || stamp(l) > stamp(remoteById.get(l.id))).length;
  return { rows: [...out.values()], pulledIds, pushed };
}

function latestById(a, b) {
  const out = new Map();
  for (const r of [...(a ?? []), ...(b ?? [])]) {
    const cur = out.get(r.id);
    if (!cur || stamp(r) > stamp(cur)) out.set(r.id, r);
  }
  return [...out.values()];
}

/**
 * Danh mục tự thêm + từ khoá: bản sửa sau cùng thắng (để xoá từ khoá ở một máy cũng có tác dụng ở máy kia).
 * Phần "đã học": gộp cả hai, máy này thắng khi trùng. meta (lần sao lưu, tài khoản Google...) là của riêng từng máy.
 */
export function mergeProfile(local = {}, remote = {}) {
  const remoteNewer = (Date.parse(remote.customUpdatedAt || 0) || 0) > (Date.parse(local.customUpdatedAt || 0) || 0);
  const winner = (remoteNewer ? remote.custom : local.custom) ?? {};
  // Danh mục tự thêm: gộp cả hai (chưa có chức năng xoá danh mục) để khoản của máy kia không rơi vào "Khác"
  const added = new Map([...(remote.custom?.added ?? []), ...(local.custom?.added ?? [])].map(c => [c.id, c]));
  return {
    // Khoản cố định, ví, lần nạp ví: theo từng mục, bản sửa sau cùng thắng (xoá = { deleted: true } để máy kia cũng xoá)
    recurring: latestById(local.recurring, remote.recurring),
    wallets: latestById(local.wallets, remote.wallets),
    allocs: latestById(local.allocs, remote.allocs),
    // Tài sản + các lần chuyển / điều chỉnh số dư: cũng theo từng mục
    assets: latestById(local.assets, remote.assets),
    assetMoves: latestById(local.assetMoves, remote.assetMoves),
    custom: { extraKeywords: winner.extraKeywords ?? {}, added: [...added.values()] },
    customUpdatedAt: remoteNewer ? remote.customUpdatedAt : local.customUpdatedAt,
    learned: { ...(remote.learned ?? {}), ...(local.learned ?? {}) },
    meta: { ...(local.meta ?? {}) },
  };
}
