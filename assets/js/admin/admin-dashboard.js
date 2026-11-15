document.addEventListener('DOMContentLoaded', async () => {
  const overview = document.getElementById('admin-overview');
  const activity = document.getElementById('admin-recent-activity');
  if (!overview || !activity) return;
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
      const recent = (data.recent_activity || []).slice(0, 8);
      activity.innerHTML = recent.length ? `<div class="admin-table-wrap"><table class="admin-data-table admin-activity-table"><thead><tr><th scope="col">Date and time</th><th scope="col">Activity</th><th scope="col">Administrator</th><th scope="col">Record</th></tr></thead><tbody>${recent.map(item => {
        const description = `${String(item.action).replaceAll('_',' ')} ${String(item.entity_type).replaceAll('_',' ')}`;
        const date = new Date(String(item.created_at || '').replace(' ', 'T'));
        const when = Number.isNaN(date.getTime()) ? item.created_at : date.toLocaleString();
        return `<tr><td data-label="Date and time">${escape(when)}</td><td data-label="Activity"><strong>${escape(description)}</strong></td><td data-label="Administrator">${escape(item.administrator)}</td><td data-label="Record">${item.entity_id ? escape(item.entity_id) : '—'}</td></tr>`;
      }).join('')}</tbody></table></div>` : '<p class="admin-table-empty">No recent activity has been recorded yet.</p>';
    } catch (error) {
      overview.innerHTML = `<p class="admin-inline-error" role="alert">Could not load campus totals: ${escape(error.message)}</p>`;
      activity.innerHTML = '<p class="p-5 text-xs text-slate-500">Activity is unavailable until the campus server responds.</p>';
    } finally {
      overview.setAttribute('aria-busy', 'false');
      if (refreshButton) refreshButton.disabled = false;
    }
  };
  document.querySelector('[data-admin-overview-refresh]')?.addEventListener('click', refresh);
  refresh();
});
