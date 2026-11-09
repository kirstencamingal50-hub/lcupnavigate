document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('map-connection-form');
  const list = document.getElementById('map-connection-list');
  const status = document.getElementById('map-connection-status');
  if (!form || !list || !status) return;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const typeLabel = type => ({walkway:'Walkway',stairs:'Stairs',ramp:'Ramp',elevator:'Elevator'}[type] || 'Unknown');
  let mapData = {nodes:[], connections:[]};

  function render() {
    const nodes = new Map(mapData.nodes.map(node => [String(node.id), node]));
    form.elements.from_node_id.innerHTML = '<option value="">Select a start node</option>' + mapData.nodes.map(node => `<option value="${esc(node.id)}">${esc(node.node_key)} · floor ${esc(node.floor_number)}</option>`).join('');
    form.elements.to_node_id.innerHTML = '<option value="">Select an end node</option>' + mapData.nodes.map(node => `<option value="${esc(node.id)}">${esc(node.node_key)} · floor ${esc(node.floor_number)}</option>`).join('');
    list.innerHTML = mapData.connections.length
      ? mapData.connections.map(edge => {
          const from = nodes.get(String(edge.from_node_id));
          const to = nodes.get(String(edge.to_node_id));
          return `<article class="rounded-xl border border-slate-200 bg-white p-4">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div><h3 class="font-bold text-slate-900">${esc(from?.node_key || 'Missing node')} → ${esc(to?.node_key || 'Missing node')}</h3>
                <p class="mt-1 text-xs text-slate-600">${esc(typeLabel(edge.connection_type))} · ${esc(edge.weight)} map units · ${Number(edge.verified) ? 'Verified' : 'Unverified'} · ${edge.accessibility_value === null ? 'Accessibility unknown' : Number(edge.accessibility_value) ? 'Accessible' : 'Not accessible'}</p>
              </div>
              <div class="flex gap-2"><button type="button" data-edit="${esc(edge.id)}" class="admin-row-action">Edit</button><button type="button" data-delete="${esc(edge.id)}" class="admin-row-action is-danger">Remove</button></div>
            </div>
          </article>`;
        }).join('')
      : '<p class="admin-empty-state">No graph connections have been created.</p>';
  }

  async function refresh() {
    mapData = await CampusApi.get('map/admin');
    render();
  }

  function resetForm() {
    form.reset();
    form.elements.id.value = '';
    form.querySelector('[type="submit"]').textContent = 'Add connection';
    document.getElementById('cancel-map-connection').hidden = true;
  }

  try {
    await refresh();
  } catch (error) {
    status.textContent = error.message;
    list.innerHTML = '<p class="admin-inline-error" role="alert">Connections could not be loaded.</p>';
    return;
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const verified = form.elements.verified.checked;
    if (verified && !await window.AdminUI.confirm({title:'Verify this walkway connection?',message:'Confirm this connection follows a real campus path before making it available to visitors.',confirmLabel:'Verify connection'})) return;
    const id = form.elements.id.value || null;
    const payload = {
      from_node_id: Number(form.elements.from_node_id.value),
      to_node_id: Number(form.elements.to_node_id.value),
      weight: Number(form.elements.weight.value),
      connection_type: form.elements.connection_type.value,
      accessible: form.elements.accessible.value === '' ? null : Number(form.elements.accessible.value),
      verified,
      confirm_walkway: verified
    };
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    status.textContent = 'Saving connection…';
    try {
      await CampusApi.save('map/connections', payload, id);
      await refresh();
      window.dispatchEvent(new CustomEvent('campus:map-graph-updated'));
      resetForm();
      status.textContent = 'Connection saved.';
      window.AdminUI?.toast('Walkway connection saved.');
    } catch (error) {
      status.textContent = error.message;
      window.AdminUI?.toast(error.message,'error');
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById('cancel-map-connection').addEventListener('click', () => {
    resetForm();
    status.textContent = 'Connection edit cancelled.';
  });

  list.addEventListener('click', async event => {
    const editButton = event.target.closest('[data-edit]');
    const deleteButton = event.target.closest('[data-delete]');
    if (editButton) {
      const edge = mapData.connections.find(item => String(item.id) === editButton.dataset.edit);
      if (!edge) return;
      form.elements.id.value = edge.id;
      form.elements.from_node_id.value = edge.from_node_id;
      form.elements.to_node_id.value = edge.to_node_id;
      form.elements.weight.value = edge.weight;
      form.elements.connection_type.value = edge.connection_type || 'walkway';
      form.elements.accessible.value = edge.accessibility_value === null ? '' : String(Number(edge.accessibility_value));
      form.elements.verified.checked = Number(edge.verified) === 1;
      form.querySelector('[type="submit"]').textContent = 'Save connection';
      document.getElementById('cancel-map-connection').hidden = false;
      form.scrollIntoView({behavior:'smooth',block:'start'});
      form.elements.from_node_id.focus();
      return;
    }
    if (!deleteButton) return;
    const edge = mapData.connections.find(item => String(item.id) === deleteButton.dataset.delete);
    if (!edge || !await window.AdminUI.confirm({title:'Remove walkway connection?',message:'Saved routes that still use this connection must be edited first. The server will prevent removal if it is still required.',confirmLabel:'Remove connection',danger:true})) return;
    deleteButton.disabled = true;
    try {
      await CampusApi.remove('map/connections', edge.id);
      await refresh();
      window.dispatchEvent(new CustomEvent('campus:map-graph-updated'));
      status.textContent = 'Connection removed.';
      window.AdminUI?.toast('Walkway connection removed.');
    } catch (error) {
      status.textContent = error.message;
      window.AdminUI?.toast(error.message,'error');
      deleteButton.disabled = false;
    }
  });
});
