document.addEventListener('DOMContentLoaded', async () => {
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const form = $('add-landmark-form'), picker = $('landmark-map-picker');
  const image = $('landmark-map-image'), pins = $('landmark-map-pins');
  const selected = $('landmark-map-selection'), list = $('landmarks-list');
  const status = $('landmark-form-status');
  if (!form || !picker) return;

  const W = 1330, H = 1620;
  let locations = [], map = {markers:[],nodes:[],connections:[]}, editing = null;
  image.src = '../../assets/images/campus-map.svg';

  const locationSearch = $('landmark-location-search');
  const locationResults = $('landmark-location-results');
  let campusRecords = [];
  const locationLabel = item => (item.kind === 'facility' ? 'Facility' : 'Building') + (item.category ? ' · ' + item.category : '') + ' — ' + item.name;
  const renderLocationResults = () => {
    const query = String(locationSearch.value || '').trim().toLocaleLowerCase();
    const matches = campusRecords.filter(item => !query || [item.name,item.kind,item.category,item.description,item.building].some(value => String(value || '').toLocaleLowerCase().includes(query))).slice(0, 40);
    locationResults.innerHTML = matches.length ? matches.map(item => '<button type="button" role="option" data-location-id="' + esc(item.id) + '" class="block w-full border-b border-slate-100 px-3 py-2.5 text-left text-xs text-slate-800 last:border-0 hover:bg-blue-50"><span class="block font-bold">' + esc(item.name) + '</span><span class="mt-0.5 block text-[10px] text-slate-500">' + esc(locationLabel(item)) + '</span></button>').join('') : '<p class="px-3 py-3 text-xs text-slate-500">No matching buildings or facilities found.</p>';
    locationResults.classList.remove('hidden');
    locationSearch.setAttribute('aria-expanded','true');
  };
  const chooseLocation = id => {
    const record = campusRecords.find(item => String(item.id) === String(id));
    if (!record) return;
    form.elements.location_id.value = String(record.id);
    locationSearch.value = locationLabel(record);
    locationResults.classList.add('hidden');
    locationSearch.setAttribute('aria-expanded','false');
    form.elements.location_id.dispatchEvent(new Event('change'));
  };
  const fillSelects = () => {
    const seenIds = new Set();
    campusRecords = locations.filter(item => ['building','facility'].includes(item.kind) && item.active !== false)
      .sort((a,b) => String(a.kind).localeCompare(String(b.kind)) || String(a.name).localeCompare(String(b.name)))
      .filter(item => { const id=String(item.id ?? ''); if (!id || seenIds.has(id)) return false; seenIds.add(id); return true; });
    form.elements.location_id.innerHTML = '<option value="">Choose a campus location</option>' + campusRecords.map(item => '<option value="' + esc(item.id) + '">' + esc(locationLabel(item)) + '</option>').join('');
    renderLocationResults();
  };
  locationSearch.addEventListener('input', () => { form.elements.location_id.value = ''; const preview=$('landmark-record-preview'); if(preview){preview.hidden=true;preview.innerHTML='';} renderLocationResults(); });
  locationSearch.addEventListener('focus', renderLocationResults);
  locationResults.addEventListener('click', event => { const option=event.target.closest('[data-location-id]'); if(option) chooseLocation(option.dataset.locationId); });
  document.addEventListener('click', event => { if(!event.target.closest('#landmark-location-search') && !event.target.closest('#landmark-location-results')) { locationResults.classList.add('hidden'); locationSearch.setAttribute('aria-expanded','false'); } });
  const position = (x, y) => {
    selected.style.left = `${Number(x) / W * 100}%`;
    selected.style.top = `${Number(y) / H * 100}%`;
    selected.classList.remove('hidden');
  };
  const render = () => {
    pins.innerHTML = map.markers.map(marker => `<span title="${esc(marker.name)}" class="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-blue-600 shadow" style="left:${Number(marker.x)/W*100}%;top:${Number(marker.y)/H*100}%"></span>`).join('');
    list.innerHTML = map.markers.length ? `<div class="overflow-x-auto"><table class="w-full text-left text-xs"><thead><tr><th class="p-3">Campus location</th><th class="p-3">Map position</th><th class="p-3">Navigation node</th><th class="p-3">Accessibility</th><th class="p-3 text-right">Actions</th></tr></thead><tbody>${map.markers.map(marker => {
      const node = map.nodes.find(item => String(item.id) === String(marker.route_node_id));
      const campusRecord = locations.find(item => String(item.id) === String(marker.location_id));
      const accessValues = campusRecord ? Object.entries(campusRecord).filter(([key,value]) => /accessib|accessibility/i.test(key) && value !== null && value !== undefined && String(value).trim() !== '').map(([key,value]) => { const label = key.replace(/([A-Z])/g,' $1').replace(/_/g,' ').replace(/^./,c=>c.toUpperCase()); const detail = Array.isArray(value) ? value.join(', ') : typeof value === 'object' ? JSON.stringify(value) : String(value); return label + ': ' + detail; }) : [];
      const accessText = accessValues.length ? accessValues.join(' · ') : 'N/A';
      return `<tr class="border-t"><td class="p-3 font-bold">${esc(marker.name)}</td><td class="p-3">${esc(marker.x)}, ${esc(marker.y)}</td><td class="p-3">${node ? 'Generated automatically' : 'Created when a route is saved'}</td><td class="p-3">${esc(accessText)}</td><td class="p-3 text-right"><button data-action="edit-marker" data-id="${esc(marker.id)}" class="mr-3 text-blue-600 font-bold">Edit</button><button data-action="delete-marker" data-id="${esc(marker.id)}" class="text-red-600 font-bold">Delete</button></td></tr>`;
    }).join('')}</tbody></table></div>` : '<p class="p-5 text-center text-xs text-slate-500">No campus markers are stored.</p>';
  };
  const refresh = async () => {
    [locations, map] = await Promise.all([CampusApi.get('locations'), CampusApi.get('map/admin')]);
    fillSelects(); render();
    window.dispatchEvent(new CustomEvent('campusMapDataChanged', {detail:map}));
  };
  const reset = () => {
    editing = null; form.reset(); locationSearch.value = ''; locationResults.classList.add('hidden'); form.elements.location_id.value = ''; form.elements.x.value = ''; form.elements.y.value = '';
    const preview = $('landmark-record-preview'); if (preview) { preview.hidden = true; preview.innerHTML = ''; }
    selected.classList.add('hidden'); $('save-landmark').textContent = 'Add Location Marker'; $('cancel-landmark-edit').hidden = true;
  };
  form.elements.location_id.addEventListener('change', () => {
    const record = locations.find(item => String(item.id) === String(form.elements.location_id.value));
    const preview = $('landmark-record-preview');
    if (!preview) return;
    if (!record) { preview.innerHTML = ''; preview.hidden = true; return; }
    const labels = {kind:'Record type',category:'Category',description:'Description',functionDescription:'Function',parentBuilding:'Parent building',departmentName:'Department',departmentHead:'Department head',contactInfo:'Contact information',contactEmail:'Email',contactPhone:'Phone',websiteUrl:'Website',serviceHours:'Service hours',accessHours:'Access hours',daysOpen:'Days open',lunchBreak:'Lunch break',services:'Services',nearbyLandmarks:'Nearby landmarks',accessibilityStatus:'Accessibility status',accessibilityDetails:'Accessibility features and notes',floorLabel:'Floor',roomNumber:'Room number'};
    const excluded = new Set(['id','active','createdAt','updatedAt','created_at','updated_at','image','photos','model_3d_url','model3dUrl','canonicalLocationId','parentBuildingId']);
    const rows = Object.entries(record).filter(([key,value]) => !excluded.has(key) && value !== null && value !== undefined && String(value).trim() !== '').map(([key,value]) => {
      const label = labels[key] || key.replace(/([A-Z])/g,' $1').replace(/_/g,' ').replace(/^./,c=>c.toUpperCase());
      const text = Array.isArray(value) ? value.join(', ') : typeof value === 'object' ? JSON.stringify(value) : String(value);
      return '<div class="grid grid-cols-[minmax(105px,auto)_1fr] gap-2 border-b border-slate-100 py-1.5 last:border-0"><dt class="font-semibold text-slate-500">' + esc(label) + '</dt><dd class="min-w-0 whitespace-pre-wrap break-words text-slate-800">' + esc(text) + '</dd></div>';
    }).join('');
    preview.innerHTML = '<h3 class="mb-2 text-xs font-extrabold text-slate-800">Saved campus record information</h3><dl class="text-xs">' + (rows || '<p class="text-slate-500">No additional information has been saved for this record.</p>') + '</dl>';
    preview.hidden = false;
  });
  const getMapCoordinates = event => {
    const rect = picker.getBoundingClientRect();
    const contentWidth = picker.clientWidth;
    const contentHeight = picker.clientHeight;
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left - picker.clientLeft) / contentWidth));
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top - picker.clientTop) / contentHeight));
    return {x:Math.round(x * W),y:Math.round(y * H)};
  };
  picker.addEventListener('click', event => {
    const {x:px,y:py} = getMapCoordinates(event);
    form.elements.x.value = px; form.elements.y.value = py; position(px, py);
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const saveButton = $('save-landmark');
    const locationId = form.elements.location_id.value;
    if (!locationId) { status.textContent = 'Choose an existing campus location.'; return; }
    if (!form.elements.x.value || !form.elements.y.value) { status.textContent = 'Click the map to set this location’s position.'; return; }
    const payload = {location_id:Number(locationId),x:Number(form.elements.x.value),y:Number(form.elements.y.value),floor_number:0,map_key:'campus'};
    try {
      saveButton.disabled = true;
      await CampusApi.save('map/markers', payload, editing);
      status.textContent = 'Map marker saved. Navigation nodes and route connections are generated from saved walking paths.';
      window.AdminUI?.toast(editing ? 'Map marker updated.' : 'Campus location added to map.');
      reset(); await refresh();
    } catch (error) { status.textContent = error.message; window.AdminUI?.toast(error.message, 'error'); }
    finally { saveButton.disabled = false; }
  });
  $('cancel-landmark-edit').addEventListener('click', reset);
  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const id = Number(button.dataset.id); button.disabled = true;
    try {
      if (button.dataset.action === 'edit-marker') {
        const marker = map.markers.find(item => Number(item.id) === id); if (!marker) return;
        editing = id; chooseLocation(marker.location_id);
        form.elements.x.value = marker.x; form.elements.y.value = marker.y; position(marker.x, marker.y);
        $('save-landmark').textContent = 'Save Changes'; $('cancel-landmark-edit').hidden = false;
        form.scrollIntoView({behavior:'smooth',block:'center'});
      }
      if (button.dataset.action === 'delete-marker') {
        const marker = map.markers.find(item => Number(item.id) === id);
        if (!await window.AdminUI.confirm({title:'Delete map marker?',message:`Permanently delete the map marker for “${marker?.name || 'this location'}”? Any routes that use this marker will also be deleted.`,confirmLabel:'Delete marker',danger:true})) return;
        await CampusApi.remove('map/markers', id); await refresh();
        window.AdminUI?.toast('Map marker and dependent routes permanently deleted.');
      }
    } catch (error) { status.textContent = error.message; window.AdminUI?.toast(error.message, 'error'); }
    finally { button.disabled = false; }
  });
  try { await refresh(); } catch (error) { status.textContent = error.message; }
});
