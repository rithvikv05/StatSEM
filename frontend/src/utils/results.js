export function initResults() {
  // ─── Results Tree Toggle ───────────────────────────────────────────────
  window.toggleTreeSection = function(headerEl) {
    const icon = headerEl.querySelector('svg');
    const items = headerEl.nextElementSibling;
    if (items) {
      const isHidden = items.style.display === 'none';
      items.style.display = isHidden ? 'flex' : 'none';
      if (icon) {
        if (isHidden) {
          icon.classList.add('open');
          icon.style.transform = 'rotate(90deg)';
        } else {
          icon.classList.remove('open');
          icon.style.transform = 'rotate(0deg)';
        }
      }
    }
  };

  // ─── Results Tree Active State ─────────────────────────────────────────
  const treeItems = document.querySelectorAll('.tree-item');
  treeItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      treeItems.forEach(i => i.classList.remove('active'));
      item.classList.add('active');
    });
  });

  // ─── View Toggles (Matrix vs List) ─────────────────────────────────────
  const viewBtns = document.querySelectorAll('.view-toggle__btn');
  viewBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      viewBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
}
