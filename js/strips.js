// Hàng ô cuộn ngang (Ví, Tài sản) trên máy tính: điện thoại vuốt được sẵn, còn chuột thì không.
//  - Lăn chuột lên/xuống khi trỏ vào hàng → cuộn ngang; tới đầu/cuối hàng thì để trang cuộn tiếp như thường
//  - Nhấn giữ chuột rồi kéo → cuộn theo tay; kéo xong không tính là bấm vào ô
// Chỉ áp dụng cho chuột (pointerType 'mouse'), không đụng tới cảm ứng.

const DRAG_START = 5; // px — di chuyển ít hơn thì vẫn là bấm

function onWheel(e) {
  const el = e.currentTarget;
  if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // phóng to, hoặc touchpad đã cuộn ngang sẵn
  const max = el.scrollWidth - el.clientWidth;
  if (max <= 0) return;
  const dy = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY; // chế độ "theo dòng" (Firefox)
  if ((dy < 0 && el.scrollLeft <= 0) || (dy > 0 && el.scrollLeft >= max - 1)) return;
  e.preventDefault();
  el.scrollLeft += dy;
}

function enableDrag(el) {
  let drag = null;
  el.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'mouse' || e.button !== 0 || el.scrollWidth <= el.clientWidth) return;
    drag = { x: e.clientX, left: el.scrollLeft, moved: false, id: e.pointerId };
  });
  el.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < DRAG_START) return;
    if (!drag.moved) {
      drag.moved = true;
      el.setPointerCapture(e.pointerId);
      el.classList.add('dragging');
    }
    el.scrollLeft = drag.left - dx;
  });
  const end = () => {
    if (!drag) return;
    if (drag.moved) {
      el.classList.remove('dragging');
      // Thả chuột sau khi kéo cũng sinh ra "click" vào ô dưới chuột → chặn lần click đó
      // (click đến ngay sau pointerup; gỡ bộ chặn sau đó để không nuốt mất lần bấm thật kế tiếp)
      const block = ev => { ev.stopPropagation(); ev.preventDefault(); };
      el.addEventListener('click', block, { capture: true, once: true });
      setTimeout(() => { el.removeEventListener('click', block, { capture: true }); drag = null; }, 0);
    } else {
      drag = null;
    }
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('dragstart', e => e.preventDefault()); // không kéo nhầm ảnh / chữ
}

/** Gắn cuộn bằng chuột cho các hàng ô (phần tử chứa giữ nguyên, nội dung vẽ lại thoải mái). */
export function enableMouseScroll(els) {
  for (const el of els) {
    if (!el) continue;
    el.addEventListener('wheel', onWheel, { passive: false });
    enableDrag(el);
  }
}
