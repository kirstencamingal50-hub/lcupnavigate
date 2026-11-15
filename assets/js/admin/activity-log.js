document.addEventListener('DOMContentLoaded', async () => {
  const activity = document.getElementById('admin-recent-activity');
  if (!activity) return;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  activity.setAttribute('aria-busy', 'true');
  try {
    const data = await CampusApi.get('admin/overview');
    const recent = (data.recent_activity || []).slice(0, 8);
    activity.innerHTML = recent.length ? `<div class="admin-table-wrap"><table class="admin-data-table admin-activity-table"><thead><tr><th scope="col">Date and time</th><th scope="col">Action</th><th scope="col">Administrator</th><th scope="col">Record ID</th></tr></thead><tbody>${recent.map(item => {
      const description = `${String(item.action || '').replaceAll('_',' ')} ${String(item.entity_type || '').replaceAll('_',' ')}`.trim();
      const date = new Date(String(item.created_at || '').replace(' ', 'T'));
      const when = Number.isNaN(date.getTime()) ? item.created_at : date.toLocaleString();
      return `<tr><td data-label="Date and time">${escape(when)}</td><td data-label="Action"><strong>${escape(description)}</strong></td><td data-label="Administrator">${escape(item.administrator)}</td><td data-label="Record ID">${item.entity_id ? escape(item.entity_id) : '—'}</td></tr>`;
    }).join('')}</tbody></table></div>` : '<p class="admin-table-empty">No recent activity has been recorded yet.</p>';
  } catch (error) {
    activity.innerHTML = '<p class="admin-table-empty" role="alert">Activity is unavailable until the campus server responds.</p>';
  } finally {
    activity.setAttribute('aria-busy', 'false');
  }
});