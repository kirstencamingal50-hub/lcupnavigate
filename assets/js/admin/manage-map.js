document.addEventListener('DOMContentLoaded', async () => {
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const form = $('add-landmark-form'), picker = $('landmark-map-picker');
  const image = $('landmark-map-image'), pins = $('landmark-map-pins');
  const selected = $('landmark-map-selection'), list = $('landmarks-list');
  const status = $('landmark-form-status'), plansForm = $('floorplan-form');
  const planStatus = $('floorplan-status');
  if (!form || !picker) return;

  const W = 1330, H = 1620;
  let locations = [], map = {markers:[],nodes:[],connections:[]}, plans = [], editing = null, netlifyBackend = false;
  image.src = '../../assets/images/campus-map.svg';

  const fill = (select, rows, value, label) => {
    select.innerHTML = '<option value="">None</option>' + rows.map(row => `<option value="${esc(row[value])}">${esc(label(row))}</option>`).join('');
  };
  const fillSelects = () => {
    fill(form.elements.location_id, locations, 'id', item => item.name);
    fill(form.elements.route_node_id, map.nodes, 'id', item => item.node_key);
    fill(plansForm.elements.building_id, locations.filter(item => item.kind === 'building'), 'id', item => item.name);
  };
  const position = (x, y) => {
    selected.style.left = `${Number(x) / W * 100}%`;
    selected.style.top = `${Number(y) / H * 100}%`;
    selected.classList.remove('hidden');
  };
  const render = () => {
    pins.innerHTML = map.markers.map(marker => `<span title="${esc(marker.name)}" class="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-blue-600 shadow" style="left:${Number(marker.x)/W*100}%;top:${Number(marker.y)/H*100}%"></span>`).join('');
    list.innerHTML = map.markers.length ? `<div class="overflow-x-auto"><table class="w-full text-left text-xs"><thead><tr><th class="p-3">Campus location</th><th class="p-3">Position</th><th class="p-3">Route endpoint</th><th class="p-3">Accessibility</th><th class="p-3 text-right">Actions</th></tr></thead><tbody>${map.markers.map(marker => `<tr class="border-t"><td class="p-3 font-bold">${esc(marker.name)}</td><td class="p-3">${esc(marker.x)}, ${esc(marker.y)}</td><td class="p-3">${esc(map.nodes.find(node => String(node.id) === String(marker.route_node_id))?.node_key || 'None')}</td><td class="p-3">${marker.accessibility_value === null ? 'Unspecified' : Number(marker.accessibility_value) ? 'Accessible' : 'Not accessible'}</td><td class="p-3 text-right"><button data-action="edit-marker" data-id="${esc(marker.id)}" class="mr-3 text-blue-600 font-bold">Edit</button><button data-action="delete-marker" data-id="${esc(marker.id)}" class="text-red-600 font-bold">Remove</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="p-5 text-center text-xs text-slate-500">No markers are stored.</p>';
    $('floorplans-list').innerHTML = plans.map(plan => {
      const reviewLabel = plan.verified === undefined ? '' : ` · ${Number(plan.verified)?'Verified':'Review needed'}`;
      return `<div class="flex flex-wrap items-center gap-3 rounded-lg border p-3 text-xs"><span class="flex-1">${esc(plan.original_name)} · Floor ${esc(plan.floor_number)}${reviewLabel}</span><a class="text-blue-600 underline" target="_blank" rel="noopener" href="../../${esc(plan.file_url)}">View</a>${netlifyBackend?`<button data-action="toggle-plan" data-id="${esc(plan.id)}" class="font-bold text-blue-700">${Number(plan.verified)?'Unverify':'Verify'}</button>`:''}<button data-action="delete-plan" data-id="${esc(plan.id)}" class="text-red-600 font-bold">Remove</button></div>`;
    }).join('') || '<p class="text-xs text-slate-500">No floor plans uploaded.</p>';
  };
  const refresh = async () => {
    [locations, map, plans] = await Promise.all([CampusApi.get('locations'), CampusApi.get('map/admin'), CampusApi.get('floorplans')]);
    netlifyBackend = await CampusApi.isNetlify();
    fillSelects(); render();
    window.dispatchEvent(new CustomEvent('campusMapDataChanged', {detail:map}));
  };
  const reset = () => {
    editing = null; form.reset(); form.elements.x.value = ''; form.elements.y.value = '';
    selected.classList.add('hidden'); $('save-landmark').textContent = 'Add Landmark'; $('cancel-landmark-edit').hidden = true;
  };
  picker.addEventListener('click', event => {
    const rect = picker.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left - picker.clientLeft) / picker.clientWidth));
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top - picker.clientTop) / picker.clientHeight));
    const px = Math.round(x * W), py = Math.round(y * H);
    form.elements.x.value = px; form.elements.y.value = py; position(px, py);
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const saveButton=$('save-landmark');
    const locationId = form.elements.location_id.value;
    if (!locationId) { status.textContent = 'Select an existing campus record.'; return; }
    if (!form.elements.x.value) { status.textContent = 'Click the map to set marker coordinates.'; return; }
    const access = form.elements.accessibility_status.value;
    const payload = {location_id:Number(locationId),x:Number(form.elements.x.value),y:Number(form.elements.y.value),floor_number:0,map_key:'campus',route_node_id:form.elements.route_node_id.value || null,accessibility_status:access === '' ? null : Number(access)};
    try {
      saveButton.disabled=true;
      const saved=editing?await CampusApi.save('map/markers',payload,editing):await CampusApi.save('map/markers',payload);
      status.textContent=editing?'Map marker saved.':`Map marker saved with its ${saved.draft_status||'incomplete'} route record. Open it in the Route Builder to add or finish its path.`;
      window.AdminUI?.toast(editing?'Map marker updated.':'Map landmark added.');
      reset();await refresh();
    } catch (error) { status.textContent = `${error.message} Save the marker again to retry; the server reuses an existing marker and its draft route.`;window.AdminUI?.toast(error.message,'error'); }
    finally { saveButton.disabled=false; }
  });
  $('cancel-landmark-edit').addEventListener('click', reset);
  plansForm.addEventListener('submit', async event => {
    event.preventDefault();
    const data = new FormData();
    data.append('file', plansForm.elements.file.files[0]); data.append('type', 'floorplan');
    data.append('building_id', plansForm.elements.building_id.value); data.append('floor_number', plansForm.elements.floor_number.value);
    const uploadButton=plansForm.querySelector('[type="submit"]');uploadButton.disabled=true;
    try { await CampusApi.request('uploads', {method:'POST',body:data}); plansForm.reset(); planStatus.textContent = 'Floor plan uploaded.';window.AdminUI?.toast('Floor plan uploaded.'); await refresh(); }
    catch (error) { planStatus.textContent = error.message;window.AdminUI?.toast(error.message,'error'); }
    finally { uploadButton.disabled=false; }
  });
  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-action]'); if (!button) return;
    const id = Number(button.dataset.id); button.disabled = true;
    try {
      if (button.dataset.action === 'edit-marker') {
        const marker = map.markers.find(item => Number(item.id) === id); if (!marker) return;
        editing = id; form.elements.location_id.value = String(marker.location_id);
        form.elements.route_node_id.value = marker.route_node_id ? String(marker.route_node_id) : '';
        form.elements.accessibility_status.value = marker.accessibility_value === null ? '' : String(marker.accessibility_value);
        form.elements.x.value = marker.x; form.elements.y.value = marker.y; position(marker.x, marker.y);
        $('save-landmark').textContent = 'Save Changes'; $('cancel-landmark-edit').hidden = false;
        form.scrollIntoView({behavior:'smooth',block:'center'});
      }
      if (button.dataset.action === 'delete-marker') {
        const marker=map.markers.find(item=>Number(item.id)===id);
        if (!await window.AdminUI.confirm({title:'Remove map marker?',message:`Remove the map marker for “${marker?.name||'this location'}”? Related route records remain subject to server relationship checks.`,confirmLabel:'Remove marker',danger:true})) return;
        await CampusApi.remove('map/markers', id); await refresh();
        window.AdminUI?.toast('Map marker removed.');
      }
      if (button.dataset.action === 'delete-plan') {
        const plan=plans.find(item=>Number(item.id)===id);
        if (!await window.AdminUI.confirm({title:'Remove floor plan?',message:`Remove “${plan?.original_name||'this floor plan'}”? Building and route data will not be deleted.`,confirmLabel:'Remove floor plan',danger:true})) return;
        await CampusApi.remove('floorplans', id); await refresh();
        window.AdminUI?.toast('Floor plan removed.');
      }
      if (button.dataset.action === 'toggle-plan') {
        const plan = plans.find(item => Number(item.id) === id);
        if (!plan) return;
        const verified = !Number(plan.verified);
        if (verified && !await window.AdminUI.confirm({title:'Verify floor plan?',message:`Confirm that “${plan.original_name}” is accurate and approved for public viewing.`,confirmLabel:'Verify floor plan'})) return;
        await CampusApi.request('floorplans', {method:'PUT',body:{id,verified}});
        await refresh();
        window.AdminUI?.toast(verified?'Floor plan verified.':'Floor plan returned to review.');
      }
    } catch (error) { status.textContent = error.message;window.AdminUI?.toast(error.message,'error'); }
    finally { button.disabled = false; }
  });
  try { await refresh(); } catch (error) { status.textContent = error.message; }
});
