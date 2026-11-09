(() => {
  const list=document.getElementById('admin-account-list');
  if(!list)return;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let rows=[], currentId=null;
  async function refresh(){
    try{
      const [accounts,me]=await Promise.all([CampusApi.get('admin/accounts'),CampusApi.get('auth/me')]);rows=accounts;currentId=Number(me.user?.id);
      list.innerHTML=rows.length?`<div class="overflow-x-auto"><table class="admin-settings-table"><thead><tr><th>Name</th><th>Username / email</th><th>Role</th><th>Status</th><th>Action</th></tr></thead><tbody>${rows.map(row=>`<tr data-id="${esc(row.id)}"><td>${esc(row.full_name||row.username)}</td><td>${esc(row.username)}<small>${esc(row.email||'Email not set')}</small></td><td><select data-role aria-label="Role for ${esc(row.username)}" ${Number(row.id)===currentId?'disabled':''}><option value="admin" ${row.role==='admin'?'selected':''}>Admin</option><option value="editor" ${row.role==='editor'?'selected':''}>Editor</option><option value="viewer" ${row.role==='viewer'?'selected':''}>Viewer</option></select></td><td><span class="admin-status ${Number(row.active)?'is-positive':'is-neutral'}">${Number(row.active)?'Active':'Inactive'}</span></td><td><button type="button" data-save class="admin-row-action" ${Number(row.id)===currentId?'disabled':''}>Save</button><button type="button" data-toggle class="admin-row-action ${Number(row.active)?'is-danger':''}" ${Number(row.id)===currentId?'disabled':''}>${Number(row.active)?'Disable':'Enable'}</button></td></tr>`).join('')}</tbody></table></div>`:'<p class="admin-empty-state">No administrator accounts found.</p>';
    }catch(error){list.innerHTML=`<p class="admin-inline-error">${esc(error.message)}</p>`;}
  }
  list.addEventListener('click',async event=>{
    const button=event.target.closest('button[data-save],button[data-toggle]');if(!button)return;
    const row=rows.find(item=>Number(item.id)===Number(button.closest('tr').dataset.id));if(!row)return;
    const role=button.closest('tr').querySelector('[data-role]').value;
    const active=button.hasAttribute('data-toggle')?!Number(row.active):Number(row.active);
    const accountName=row.full_name||row.username;
    const verb=active?'enable':'disable';if(button.hasAttribute('data-toggle')&&!await window.AdminUI.confirm({title:`${active?'Enable':'Disable'} administrator account?`,message:`${active?'Enable':'Disable'} ${accountName}'s account? This changes the account's ability to sign in.`,confirmLabel:`${active?'Enable':'Disable'} account`,danger:!active}))return;
    if(button.hasAttribute('data-save')&&role!==row.role&&!await window.AdminUI.confirm({title:'Change administrator role?',message:`Change ${accountName}'s role from ${row.role} to ${role}?`,confirmLabel:'Save role change'}))return;
    button.disabled=true;try{await CampusApi.save('admin/accounts',{role,active},row.id);await refresh();window.AdminUI?.toast(button.hasAttribute('data-toggle')?`Account ${verb}d.`:'Administrator role updated.');}catch(error){window.AdminUI?.toast(error.message,'error');button.disabled=false;}
  });
  refresh();
})();
