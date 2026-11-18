document.addEventListener('DOMContentLoaded', async () => {
  const overview = document.getElementById('admin-overview');
  if (!overview) return;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const cards = [
    ['buildings','Buildings','domain'],
    ['rooms_and_facilities','Rooms and facilities','meeting_room'],
    ['landmarks','Map landmarks','place'],
    ['campus_routes','Available routes','alt_route'],
    ['announcements','Published announcements','campaign'],
  ];
  const refresh = async () => {
    const refreshButton = document.querySelector('[data-admin-overview-refresh]');
    if (refreshButton) refreshButton.disabled = true;
    overview.setAttribute('aria-busy', 'true');
    overview.innerHTML = '<p class="admin-loading" role="status">Refreshing campus totals…</p>';
    try {
      const data = await CampusApi.get('admin/overview');
      const counts = data.counts || {};
      overview.innerHTML = cards.map(([key,label,icon]) => {
        const value = key === 'rooms_and_facilities' ? Number(counts.rooms || 0) + Number(counts.facilities || 0) : Number(counts[key] ?? 0);
        return `<article class="admin-stat"><span class="admin-stat-icon material-symbols-rounded" aria-hidden="true">${icon}</span><div><span>${label}</span><strong>${value}</strong></div></article>`;
      }).join('');
    } catch (error) {
      overview.innerHTML = `<p class="admin-inline-error" role="alert">Could not load campus totals: ${escape(error.message)}</p>`;
    } finally {
      overview.setAttribute('aria-busy', 'false');
      if (refreshButton) refreshButton.disabled = false;
    }
  };

  const archiveList = document.getElementById('admin-archive-list');
  let archiveType = 'all';
  let archivedRows = [];
  const refreshArchive = async () => {
    if (!archiveList) return;
    const refreshButton = document.querySelector('[data-archive-refresh]');
    if (refreshButton) refreshButton.disabled = true;
    archiveList.innerHTML = '<p class="admin-loading" role="status">Loading archived records…</p>';
    try {
      const [locations, rooms] = await Promise.all([CampusApi.get('locations'), CampusApi.get('rooms')]);
      archivedRows = [
        ...(locations || []).filter(row => row.active === false).map(row => ({...row, recordType: row.kind, resource: 'locations'})),
        ...(rooms || []).filter(row => row.active === false).map(row => ({...row, recordType: 'room', resource: 'rooms'}))
      ];
      renderArchive();
    } catch (error) {
      archiveList.innerHTML = `<p class="admin-inline-error" role="alert">Could not load archived records: ${escape(error.message)}</p>`;
    } finally {
      if (refreshButton) refreshButton.disabled = false;
    }
  };
  function renderArchive() {
    if (!archiveList) return;
    const rows = archivedRows.filter(row => archiveType === 'all' || row.recordType === archiveType);
    document.querySelectorAll('[data-archive-type]').forEach(button => {
      const active = button.dataset.archiveType === archiveType;
      button.setAttribute('aria-pressed', String(active));
      button.classList.toggle('admin-button-primary', active);
      button.classList.toggle('admin-button-secondary', !active);
    });
    if (!rows.length) {
      archiveList.innerHTML = '<div class="catalog-directory-empty"><span class="material-symbols-rounded" aria-hidden="true">inventory_2</span><h3>No archived records</h3><p>Archived campus records will appear here.</p></div>';
      return;
    }
    archiveList.innerHTML = rows.map(row => {
      const type = row.recordType === 'building' ? 'Building' : row.recordType === 'facility' ? 'Facility' : 'Room';
      const detail = row.recordType === 'room' ? `${row.building_name || 'Building unavailable'} · ${row.floor_label || 'Floor unavailable'} · Room ${row.room_number || '—'}` : (row.category || 'Campus');
      return `<article class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 py-3 last:border-0" data-archive-id="${escape(row.id)}" data-archive-resource="${row.resource}">
        <div class="min-w-0"><strong class="block text-sm text-slate-900">${escape(row.name)}</strong><span class="text-xs text-slate-500">${type} · ${escape(detail)}</span></div>
        <div class="flex gap-2"><button type="button" data-archive-action="restore" class="admin-button-secondary">Restore</button><button type="button" data-archive-action="delete" class="admin-button-secondary">Delete permanently</button></div>
      </article>`;
    }).join('');
  }
  document.querySelectorAll('[data-archive-type]').forEach(button => button.addEventListener('click', () => {
    archiveType = button.dataset.archiveType;
    renderArchive();
  }));
  document.querySelector('[data-archive-refresh]')?.addEventListener('click', refreshArchive);
  archiveList?.addEventListener('click', async event => {
    const button = event.target.closest('[data-archive-action]');
    if (!button) return;
    const row = button.closest('[data-archive-id]');
    const id = Number(row.dataset.archiveId);
    const resource = row.dataset.archiveResource;
    button.disabled = true;
    try {
      if (button.dataset.archiveAction === 'restore') {
        await CampusApi.request(resource, {method:'PATCH', body:{id, active:true}});
        window.AdminUI?.toast('Record restored to the active catalog.');
      } else {
        const confirmed = await window.AdminUI.confirm({
          title: 'Permanently delete this record?',
          message: 'This cannot be undone. The system will prevent deletion if linked rooms, photos, map markers, or floor plans still depend on this record.',
          confirmLabel: 'Delete permanently',
          danger: true
        });
        if (!confirmed) return;
        await CampusApi.remove(resource, id);
        window.AdminUI?.toast('Record permanently deleted.');
      }
      await refreshArchive();
      await refresh();
    } catch (error) {
      window.AdminUI?.toast(error.message, 'error');
      button.disabled = false;
    }
  });

  document.querySelector('[data-admin-overview-refresh]')?.addEventListener('click', refresh);
  refresh();
  refreshArchive();
});