(function () {
  const TABS = [
    {
      href: 'dashboard.html',
      label: 'Dash',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>'
    },
    {
      href: 'po-coach.html',
      label: 'Gym',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 6.5h11M6.5 12h11M6.5 17.5h11"/><circle cx="3.5" cy="6.5" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="17.5" r="1"/></svg>'
    },
    {
      href: 'finance.html',
      label: 'Finance',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>'
    },
    {
      href: 'work.html',
      label: 'Work',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>'
    }
  ];

  const current = location.pathname.split('/').pop() || 'dashboard.html';

  const tabs = TABS.map(t => `
    <a href="${t.href}" class="tab"${t.href === current ? ' aria-current="page"' : ''}>
      <span class="tab-icon">${t.icon}</span>
      ${t.label}
    </a>`).join('');

  document.body.insertAdjacentHTML('beforeend', `
    <nav class="tabbar">
      <div class="tabbar-inner">${tabs}</div>
    </nav>`);
})();
