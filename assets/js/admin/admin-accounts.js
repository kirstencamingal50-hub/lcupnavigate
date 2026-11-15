(() => {
  const list = document.getElementById('admin-account-list');
  if (!list) return;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[char]));

  let rows = [];
  let currentId = null;

  function updateMetrics() {
    const active = rows.filter(row => Number(row.active));
    const set = (id, value) => {
      const element = document.getElementById(id);
      if (element) element.textContent = String(value);
    };
    set('account-total', rows.length);
    set('account-active', active.length);
    set('account-admins', active.filter(row => row.role === 'admin').length);
    set('account-inactive', rows.length - active.length);
  }

  async function refresh() {
    list.innerHTML = '<p class="admin-empty-state">Loading administrator accounts…</p>';
    try {
      const [accounts, me] = await Promise.all([
        CampusApi.get('admin/accounts'),
        CampusApi.get('auth/me')
      ]);
      rows = Array.isArray(accounts) ? accounts : [];
      currentId = String(me.user?.id ?? '');
      updateMetrics();

      list.innerHTML = rows.length ? `
        <div class="admin-account-table-wrap"><table class="admin-account-table">
          <thead><tr><th>Account</th><th>Login details</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>${rows.map(row => {
            const isCurrent = String(row.id) === currentId;
            return `<tr data-id="${esc(row.id)}" class="${isCurrent ? 'is-current-account' : ''}">
              <td><strong>${esc(row.full_name || row.username || 'Unnamed account')}</strong><small>${isCurrent ? 'Your signed-in account' : 'NaviGATE account'}</small></td>
              <td><strong>${esc(row.username || 'No username')}</strong><small>${esc(row.email || 'Email not set')}</small></td>
              <td><select data-role aria-label="Role for ${esc(row.username)}" ${isCurrent ? 'disabled' : ''}>
                <option value="admin" ${row.role === 'admin' ? 'selected' : ''}>Administrator</option>
                <option value="editor" ${row.role === 'editor' ? 'selected' : ''}>Editor</option>
                <option value="viewer" ${row.role === 'viewer' ? 'selected' : ''}>Viewer</option>
              </select></td>
              <td><span class="admin-account-status ${Number(row.active) ? 'is-active' : 'is-inactive'}"><i></i>${Number(row.active) ? 'Active' : 'Inactive'}</span></td>
              <td><div class="admin-account-actions">
                <button type="button" data-save class="admin-account-action" ${isCurrent ? 'disabled' : ''}>Save role</button>
                <button type="button" data-toggle class="admin-account-action ${Number(row.active) ? 'is-warning' : 'is-positive'}" ${isCurrent ? 'disabled' : ''}>${Number(row.active) ? 'Disable' : 'Enable'}</button>
                <button type="button" data-remove class="admin-account-action is-danger" ${isCurrent ? 'disabled' : ''}>Remove</button>
              </div></td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>` : '<p class="admin-empty-state">No administrator accounts found.</p>';
    } catch (error) {
      list.innerHTML = `<p class="admin-inline-error">${esc(error.message)}</p>`;
    }
  }

  list.addEventListener('click', async event => {
    const button = event.target.closest('button[data-save],button[data-toggle],button[data-remove]');
    if (!button) return;
    const tr = button.closest('tr');
    const row = rows.find(item => String(item.id) === tr?.dataset.id);
    if (!row) return;

    const accountName = row.full_name || row.username || 'this account';
    const role = tr.querySelector('[data-role]').value;
    const isRemove = button.hasAttribute('data-remove');
    const isToggle = button.hasAttribute('data-toggle');

    if (isRemove) {
      const confirmed = await window.AdminUI.confirm({
        title: 'Permanently remove administrator?',
        message: `Remove ${accountName} from NaviGATE? Their administrator sign-in will be deleted and they will no longer be able to access the admin panel. This action cannot be undone.`,
        confirmLabel: 'Remove account',
        danger: true
      });
      if (!confirmed) return;
    } else if (isToggle) {
      const enable = !Number(row.active);
      const confirmed = await window.AdminUI.confirm({
        title: `${enable ? 'Enable' : 'Disable'} administrator account?`,
        message: `${enable ? 'Enable' : 'Disable'} ${accountName}'s access to NaviGATE?`,
        confirmLabel: `${enable ? 'Enable' : 'Disable'} account`,
        danger: !enable
      });
      if (!confirmed) return;
    } else if (role !== row.role) {
      const confirmed = await window.AdminUI.confirm({
        title: 'Change administrator role?',
        message: `Change ${accountName}'s role from ${row.role} to ${role}?`,
        confirmLabel: 'Save role change'
      });
      if (!confirmed) return;
    } else {
      window.AdminUI?.toast('No role changes to save.', 'info');
      return;
    }

    button.disabled = true;
    try {
      if (isRemove) {
        await CampusApi.remove('admin/accounts', row.id);
      } else {
        const active = isToggle ? !Number(row.active) : Number(row.active);
        await CampusApi.save('admin/accounts', { role, active }, row.id);
      }
      await refresh();
      window.AdminUI?.toast(isRemove ? 'Administrator account permanently removed.' : isToggle ? 'Account status updated.' : 'Administrator role updated.');
    } catch (error) {
      window.AdminUI?.toast(error.message, 'error');
      button.disabled = false;
    }
  });

  document.querySelector('[data-account-refresh]')?.addEventListener('click', refresh);
  refresh();
})();