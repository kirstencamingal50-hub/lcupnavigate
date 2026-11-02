document.addEventListener('DOMContentLoaded', async () => {
  const $ = id => document.getElementById(id);
  const form = $('route-builder-form');
  const mapElement = $('route-editor-map');
  if (!form || !mapElement) return;

  const W = 1330, H = 1620;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const byId = id => mapData.markers.find(marker => String(marker.id) === String(id));
  let mapData = {markers:[],nodes:[],connections:[]}, routes = [], waypoints = [], editingId = null;
  let undoStack = [], redoStack = [], dragging = null;
  let autoRouteName = true, lastGeneratedRouteName = '';
  const startSelect = form.elements.start_marker_id, endSelect = form.elements.destination_marker_id;
  const startSearch = $('route-start-search'), endSearch = $('route-end-search');
  const startSuggestions = $('route-start-suggestions'), endSuggestions = $('route-end-suggestions');
  const clone = value => JSON.parse(JSON.stringify(value));
  const status = message => { $('route-builder-status').textContent = message; };
  const snapshot = () => { undoStack.push(clone(waypoints)); if (undoStack.length > 50) undoStack.shift(); redoStack = []; };
  function markerLabel(marker) { return `${marker.name}${marker.floor_number ? ` · Floor ${marker.floor_number}` : ''}`; }
  function fillEndpointSelect(select, query = '', selected = '') {
    const current = selected || select.value;
    const records = mapData.markers;
    select.innerHTML = `<option value="">${records.length?'Choose a mapped location':'No active map pins — add one below first'}</option>` + records.map(marker => {
      const label = markerLabel(marker);
      return `<option value="${esc(marker.id)}" ${String(marker.id) === String(selected) ? 'selected' : ''}>${esc(label)}</option>`;
    }).join('');
    select.value = String(current || '');
  }

  const endpointControls = [
    { input:startSearch, select:startSelect, other:endSelect, list:startSuggestions, label:'start location' },
    { input:endSearch, select:endSelect, other:startSelect, list:endSuggestions, label:'destination' }
  ];
  function closeEndpointSuggestions(list) {
    list.classList.add('hidden');
    list.closest('.relative')?.querySelector('[role="combobox"]')?.setAttribute('aria-expanded','false');
  }
  function renderEndpointSuggestions(control) {
    const term=control.input.value.trim().toLocaleLowerCase();
    const records=mapData.markers.filter(marker=>`${marker.name} ${marker.category||''} ${marker.kind||''}`.toLocaleLowerCase().includes(term)).slice(0,50);
    control.list.innerHTML=records.length?records.map(marker=>{
      const duplicate=String(control.other.value)===String(marker.id);
      return `<li role="option"><button type="button" data-marker-id="${esc(marker.id)}" class="w-full px-3 py-2 text-left text-xs ${duplicate?'text-slate-400':'text-slate-700 hover:bg-blue-50'}"><span class="block font-semibold">${esc(markerLabel(marker))}</span><span class="mt-0.5 block text-[10px] font-normal normal-case text-slate-500">${esc(marker.category||marker.kind||'Campus location')}${duplicate?' · Already selected as the other endpoint':''}</span></button></li>`;
    }).join(''):'<li class="px-3 py-2 text-xs font-normal normal-case text-slate-500">No matching campus locations.</li>';
    control.list.classList.remove('hidden');
    control.input.setAttribute('aria-expanded','true');
  }
  endpointControls.forEach(control=>{
    control.input.addEventListener('focus',()=>{control.input.select();renderEndpointSuggestions(control);});
    control.input.addEventListener('input',()=>{
      control.select.value='';
      control.select.dispatchEvent(new Event('change',{bubbles:true}));
      renderEndpointSuggestions(control);
    });
    control.input.addEventListener('keydown',event=>{
      if(event.key==='Escape'){closeEndpointSuggestions(control.list);return;}
      if(event.key==='ArrowDown'){event.preventDefault();renderEndpointSuggestions(control);control.list.querySelector('button[data-marker-id]')?.focus();}
      if(event.key==='Enter'&&!control.list.classList.contains('hidden')){const first=control.list.querySelector('button[data-marker-id]');if(first){event.preventDefault();first.click();}}
    });
    control.list.addEventListener('pointerdown',event=>event.preventDefault());
    control.list.addEventListener('click',event=>{
      const button=event.target.closest('button[data-marker-id]');if(!button)return;
      if(String(control.other.value)===String(button.dataset.markerId)){status('Start location and destination must be different. Choose another '+control.label+'.');control.input.focus();return;}
      const marker=byId(button.dataset.markerId);if(!marker)return;
      control.select.value=String(marker.id);control.input.value=markerLabel(marker);closeEndpointSuggestions(control.list);
      control.select.dispatchEvent(new Event('change',{bubbles:true}));
    });
  });
  document.addEventListener('click',event=>endpointControls.forEach(control=>{if(!control.list.parentElement.contains(event.target))closeEndpointSuggestions(control.list);}));

  function selectedMarkers() { return [byId(startSelect.value), byId(endSelect.value)]; }
  function updateRouteName() {
    const [start, end] = selectedMarkers();
    if (!start || !end) return;
    const nameInput = form.elements.name;
    const generatedName = `${start.name} to ${end.name}`.slice(0, 120);
    if (autoRouteName || !nameInput.value.trim() || nameInput.value === lastGeneratedRouteName) {
      nameInput.value = generatedName;
      lastGeneratedRouteName = generatedName;
      autoRouteName = true;
    }
  }
  function pointCoordinates() {
    const [start, end] = selectedMarkers();
    if (!start || !end) return [];
    return [[Number(start.x), Number(start.y)], ...waypoints.map(point => [Number(point.x), Number(point.y)]), [Number(end.x), Number(end.y)]];
  }

  function draw() {
    const nodeById = new Map(mapData.nodes.map(node => [String(node.id), node]));
    const [start, end] = selectedMarkers();
    $('route-existing-paths').innerHTML=`<g pointer-events="none" fill="none" stroke="#16a34a" stroke-width="5" stroke-linecap="round" opacity=".72">${mapData.connections.map(edge=>{const from=nodeById.get(String(edge.from_node_id)),to=nodeById.get(String(edge.to_node_id));return from&&to?`<line x1="${Number(from.x)}" y1="${Number(from.y)}" x2="${Number(to.x)}" y2="${Number(to.y)}" />`:'';}).join('')}</g><g pointer-events="none" fill="#15803d" stroke="white" stroke-width="3">${mapData.nodes.map(node=>`<circle cx="${Number(node.x)}" cy="${Number(node.y)}" r="8"><title>${esc(node.node_key)}</title></circle>`).join('')}</g>`;
    $('route-editor-endpoints').innerHTML = mapData.markers.map(marker=>{
      const selectedStart=String(marker.id)===String(start?.id), selectedEnd=String(marker.id)===String(end?.id);
      return `<button type="button" class="route-map-location ${selectedStart?'is-start':''} ${selectedEnd?'is-end':''}" data-marker-id="${esc(marker.id)}" style="left:${Number(marker.x)/W*100}%;top:${Number(marker.y)/H*100}%" title="${esc(marker.name)}" aria-label="Select ${esc(marker.name)} as a route endpoint"></button>`;
    }).join('');
    $('route-editor-waypoints').innerHTML = waypoints.map((point,index) =>
      `<button type="button" class="route-waypoint-handle ${point.node_id ? 'is-reused' : ''}" data-point-index="${index}" style="left:${Number(point.x)/W*100}%;top:${Number(point.y)/H*100}%" aria-label="Waypoint ${index+1}, drag to adjust">${index+1}</button>`).join('');
    const coordinates = pointCoordinates();
    $('route-draft-line').setAttribute('points', coordinates.map(point => point.join(',')).join(' '));
    renderWaypointList(nodeById);
    renderDistance(coordinates);
  }

  function renderWaypointList(nodeById = new Map(mapData.nodes.map(node => [String(node.id),node]))) {
    const list = $('route-waypoint-list');
    if (!waypoints.length) {
      list.innerHTML = '<li class="rounded-lg border border-dashed border-slate-300 p-3 text-xs text-slate-500">No intermediate points. Click the map to add walkway points.</li>';
      return;
    }
    list.innerHTML = waypoints.map((point,index) => {
      const node = point.node_id ? nodeById.get(String(point.node_id)) : null;
      const label = node ? node.node_key : 'New walkway point';
      return `<li class="route-waypoint-row"><span class="route-waypoint-number">${index+1}</span><span class="min-w-0 flex-1"><strong class="block whitespace-normal break-words">${esc(label)}</strong><small>${Math.round(point.x)}, ${Math.round(point.y)} · floor ${Number(point.floor_number)||0}</small></span><button type="button" data-waypoint-action="up" data-index="${index}" aria-label="Move waypoint up" ${index===0?'disabled':''}>↑</button><button type="button" data-waypoint-action="down" data-index="${index}" aria-label="Move waypoint down" ${index===waypoints.length-1?'disabled':''}>↓</button><button type="button" data-waypoint-action="remove" data-index="${index}" aria-label="Remove waypoint">×</button><label class="route-waypoint-notes">Direction note<textarea data-waypoint-notes data-index="${index}" rows="2" maxlength="255" aria-label="Direction note for waypoint ${index+1}">${esc(point.notes||'')}</textarea></label></li>`;
    }).join('');
  }

  function renderDistance(coordinates = pointCoordinates()) {
    const summary = $('route-distance-preview');
    if (coordinates.length < 2) { summary.textContent = 'Choose a start and destination to preview the route.'; return; }
    const distance = coordinates.slice(1).reduce((total, point, index) => total + Math.hypot(point[0]-coordinates[index][0],point[1]-coordinates[index][1]),0);
    summary.innerHTML = `<strong class="block text-slate-900">${distance.toFixed(1)} map units</strong><span>Approximate drawn distance. Define the map scale to calculate meters and walking time.</span>`;
  }

  function renderRoutes() {
    const filter = $('route-list-filter').value.trim().toLocaleLowerCase();
    const matches = routes.filter(route => `${route.name} ${route.start_name} ${route.destination_name} ${route.notes||''} ${route.status}`.toLocaleLowerCase().includes(filter));
    const seenPaths=new Set();
    const rows=matches.filter(route=>{
      const points=(route.points||[]).map(point=>`${Math.round(Number(point.x)*10)/10},${Math.round(Number(point.y)*10)/10},${Number(point.floor_number)||0}`);
      if(points.length<2)return true;
      const forward=points.join('|'),reverse=[...points].reverse().join('|'),key=forward<reverse?forward:reverse;
      if(seenPaths.has(key))return false;
      seenPaths.add(key);return true;
    });
    $('saved-routes-list').innerHTML = rows.length ? `<div class="overflow-x-auto"><table class="w-full min-w-[760px] text-left text-xs"><thead><tr><th class="p-3">Route</th><th class="p-3">Start → destination</th><th class="p-3">Distance</th><th class="p-3">Accessibility</th><th class="p-3">Status</th><th class="p-3 text-right">Actions</th></tr></thead><tbody>${rows.map(route => {const label=({active:'Completed',inactive:'Inactive',draft:'Draft',incomplete:'Incomplete'})[route.status]||route.status;const badge=route.status==='active'?'bg-emerald-50 text-emerald-800':route.status==='incomplete'?'bg-amber-50 text-amber-800':'bg-slate-100 text-slate-700';return `<tr class="border-t border-slate-100"><td class="p-3"><strong>${esc(route.name)}</strong>${route.notes?`<small class="mt-1 block whitespace-normal break-words text-slate-600">${esc(route.notes)}</small>`:''}<small class="mt-1 block text-slate-500">Updated ${esc(new Date(route.updated_at).toLocaleString())}</small></td><td class="p-3">${esc(route.start_name)} → ${esc(route.destination_name)}${route.landmark_marker_id?`<small class="mt-1 block text-blue-700">Landmark draft · ${esc(route.start_x)}, ${esc(route.start_y)}</small>`:''}</td><td class="p-3">${route.distance_map_units === null ? 'Unavailable' : `${Number(route.distance_map_units).toFixed(1)} map units`}</td><td class="p-3">${route.accessibility_status === null ? 'Unspecified' : Number(route.accessibility_status) ? 'Accessible' : 'Not accessible'}</td><td class="p-3"><span class="rounded-full px-2 py-1 ${badge}">${esc(label)}</span></td><td class="p-3 text-right"><div class="flex justify-end gap-2"><button type="button" data-route-action="edit" data-id="${route.id}" class="font-bold text-blue-700">Edit</button>${route.status==='active'||route.status==='inactive'?`<button type="button" data-route-action="toggle" data-id="${route.id}" class="font-bold text-amber-700">${route.status==='active'?'Deactivate':'Reactivate'}</button>`:''}<button type="button" data-route-action="delete" data-id="${route.id}" class="font-bold text-red-700">Delete</button></div></td></tr>`}).join('')}</tbody></table></div>` : '<p class="p-5 text-center text-xs text-slate-500">No saved routes match this filter.</p>';
  }

  async function refresh() {
    [mapData,routes] = await Promise.all([CampusApi.get('map/admin'),CampusApi.get('routes')]);
    fillEndpointSelect(startSelect,startSearch.value,startSelect.value);
    fillEndpointSelect(endSelect,endSearch.value,endSelect.value);
    draw(); renderRoutes();
  }
  window.addEventListener('campus:map-graph-updated', () => {
    refresh().catch(error => {
      const status = $('route-builder-status');
      if (status) status.textContent = error.message;
    });
  });
  window.addEventListener('campusMapDataChanged',async event=>{
    mapData=event.detail||mapData;
    fillEndpointSelect(startSelect,startSearch.value,startSelect.value);
    fillEndpointSelect(endSelect,endSearch.value,endSelect.value);
    draw();
    try { routes=await CampusApi.get('routes');renderRoutes(); }
    catch(error) { status(error.message); }
  });

  function mapPoint(event) {
    const rect = mapElement.getBoundingClientRect();
    return {x:Math.round(Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width))*W),y:Math.round(Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height))*H)};
  }

  function addMapPoint(event) {
    if (event.target.closest('.route-waypoint-handle,.route-endpoint,.route-map-location')) return;
    const [start,end]=selectedMarkers();
    if (!start||!end||start.id===end.id) { status('Choose different start and destination locations before adding path points.'); return; }
    const point=mapPoint(event);
    const nearest=mapData.nodes.filter(node=>Number(node.active)!==0).map(node=>({node,distance:Math.hypot(Number(node.x)-point.x,Number(node.y)-point.y)})).sort((a,b)=>a.distance-b.distance)[0];
    snapshot();
    if(nearest && nearest.distance<=Math.max(26,26*W/mapElement.clientWidth)) {
      waypoints.push({node_id:Number(nearest.node.id),x:Number(nearest.node.x),y:Number(nearest.node.y),floor_number:Number(nearest.node.floor_number)||0});
      status(`Added existing shared node “${nearest.node.node_key}”.`);
    } else {
      waypoints.push({x:point.x,y:point.y,floor_number:0});
      status('Added a walkway point.');
    }
    draw();
  }

  function movePoint(index,event) {
    event.preventDefault(); event.stopPropagation();
    snapshot();
    const handle=event.target.closest('.route-waypoint-handle');
    if(!handle)return;
    dragging={index,handle,pointerId:event.pointerId};
    mapElement.classList.add('is-dragging-waypoint');
    handle.setPointerCapture?.(event.pointerId);
  }
  let suppressMapClick = false;
  mapElement.addEventListener('dragstart',event=>event.preventDefault());
  mapElement.addEventListener('pointerdown',event=>{
    const handle=event.target.closest('.route-waypoint-handle');
    if(!handle)return;
    suppressMapClick=true;
    movePoint(Number(handle.dataset.pointIndex),event);
  });
  mapElement.addEventListener('pointermove',event=>{
    if(!dragging)return;
    event.preventDefault();event.stopPropagation();
    const point=mapPoint(event);const current=waypoints[dragging.index];
    waypoints[dragging.index]={x:point.x,y:point.y,floor_number:Number(current.floor_number)||0,notes:current.notes||''};
    dragging.handle.style.left=`${point.x/W*100}%`;dragging.handle.style.top=`${point.y/H*100}%`;
    $('route-draft-line').setAttribute('points',pointCoordinates().map(p=>p.join(',')).join(' '));renderDistance();
  });
  const stopDragging=()=>{
    if(!dragging)return;
    const {handle,pointerId}=dragging;
    if(handle.hasPointerCapture?.(pointerId))handle.releasePointerCapture(pointerId);
    dragging=null;mapElement.classList.remove('is-dragging-waypoint');draw();
    setTimeout(()=>{suppressMapClick=false;},0);
  };
  mapElement.addEventListener('pointerup',stopDragging);mapElement.addEventListener('pointercancel',stopDragging);
  mapElement.addEventListener('click',event=>{if(suppressMapClick){event.preventDefault();return;}addMapPoint(event);});

  [startSelect,endSelect].forEach(select=>select.addEventListener('change',()=>{updateRouteName();draw();}));
  form.elements.name.addEventListener('input',()=>{if(form.elements.name.value!==lastGeneratedRouteName)autoRouteName=false;});
  $('route-editor-endpoints').addEventListener('click',event=>{
    const button=event.target.closest('[data-marker-id]');if(!button)return;event.stopPropagation();
    const id=String(button.dataset.markerId);
    if(startSelect.value===id)startSelect.value='';
    else if(endSelect.value===id)endSelect.value='';
    else if(!startSelect.value)startSelect.value=id;
    else endSelect.value=id;
    startSearch.value=byId(startSelect.value)?markerLabel(byId(startSelect.value)):'';
    endSearch.value=byId(endSelect.value)?markerLabel(byId(endSelect.value)):'';
    updateRouteName();
    draw();
    const marker=byId(id);status(`${marker?.name||'Location'} selected. Choose the other endpoint or add route waypoints.`);
  });
  $('route-list-filter').addEventListener('input',renderRoutes);
  $('route-undo').addEventListener('click',()=>{if(!undoStack.length)return;redoStack.push(clone(waypoints));waypoints=undoStack.pop();draw();});
  $('route-redo').addEventListener('click',()=>{if(!redoStack.length)return;undoStack.push(clone(waypoints));waypoints=redoStack.pop();draw();});
  $('route-clear').addEventListener('click',()=>{if(!waypoints.length)return;snapshot();waypoints=[];draw();status('Waypoints cleared.');});
  $('route-waypoint-list').addEventListener('input',event=>{
    const input=event.target.closest('[data-waypoint-notes]');if(!input)return;
    const point=waypoints[Number(input.dataset.index)];if(point)point.notes=input.value;
  });
  $('route-waypoint-list').addEventListener('click',event=>{
    const button=event.target.closest('[data-waypoint-action]');if(!button)return;const index=Number(button.dataset.index),action=button.dataset.waypointAction;
    if(action==='remove'){snapshot();waypoints.splice(index,1);}
    else {const next=index+(action==='up'?-1:1);if(next<0||next>=waypoints.length)return;snapshot();[waypoints[index],waypoints[next]]=[waypoints[next],waypoints[index]];}
    draw();
  });

  function resetForm() {
    editingId=null;form.reset();waypoints=[];undoStack=[];redoStack=[];
    autoRouteName=true;lastGeneratedRouteName='';
    fillEndpointSelect(startSelect,startSearch.value);fillEndpointSelect(endSelect,endSearch.value);
    $('route-save-draft').textContent='Save Private Draft';$('route-publish').textContent='Publish Route';$('route-cancel-edit').hidden=true;draw();
  }
  $('route-cancel-edit').addEventListener('click',resetForm);

  async function saveRoute(routeStatus) {
    const [start,end]=selectedMarkers();
    if(!form.reportValidity())return;
    if(!start||!end){status('Choose mapped start and destination locations.');return;}
    if(start.id===end.id&&routeStatus==='active'){status('A completed route needs two different endpoint markers.');return;}
    if(start.id===end.id&&waypoints.length){status('Choose a different destination before saving these path points.');return;}
    const coordinates=pointCoordinates();
    const distance=coordinates.slice(1).reduce((sum,point,index)=>sum+Math.hypot(point[0]-coordinates[index][0],point[1]-coordinates[index][1]),0);
    const actionLabel=routeStatus==='active'?'Publish this route':'Save this private draft';
    const summary=`${form.elements.name.value.trim()}\n${start.name} → ${end.name}\n${waypoints.length} intermediate point(s), about ${distance.toFixed(1)} map units.\n\nWalking time is unavailable because the map has no defined scale. ${actionLabel}?`;
    const publicationNotice=routeStatus==='active'?'\n\nPublished routes are immediately visible to visitors. Confirm the directions are accurate before publishing.':'';
    if(!confirm(summary+publicationNotice))return;
    const buttons=[$('route-save-draft'),$('route-publish')];
    buttons.forEach(saveButton=>saveButton.disabled=true);
    status(routeStatus==='active'?'Publishing route…':'Saving private route draft…');
    const payload={name:form.elements.name.value.trim(),start_marker_id:Number(start.id),destination_marker_id:Number(end.id),status:routeStatus,accessibility_status:form.elements.accessibility_status.value===''?null:Number(form.elements.accessibility_status.value),notes:form.elements.notes.value.trim()||null,waypoints:waypoints.map(point=>point.node_id?{node_id:Number(point.node_id),notes:point.notes?.trim()||null}:{x:Number(point.x),y:Number(point.y),floor_number:Number(point.floor_number)||0,notes:point.notes?.trim()||null})};
    try {
      const saved=await CampusApi.request('routes',{method:editingId?'PUT':'POST',body:editingId?{...payload,id:editingId}:payload});
      status(saved.distance_map_units===null?'Incomplete landmark route saved. It remains private until a path is completed.':routeStatus==='active'?`Route published (${Number(saved.distance_map_units).toFixed(1)} map units). It is now available in navigation.`:`Route draft saved (${Number(saved.distance_map_units).toFixed(1)} map units). It remains private until published.`);
      resetForm();await refresh();
    } catch(error) { status(error.message); }
    finally { buttons.forEach(saveButton=>saveButton.disabled=false); }
  }
  $('route-save-draft').addEventListener('click',event=>saveRoute(event.currentTarget.dataset.routeStatus));
  $('route-publish').addEventListener('click',event=>saveRoute(event.currentTarget.dataset.routeStatus));

  function loadRoute(route,mode='edit') {
    editingId=mode==='edit'?Number(route.id):null;
    form.elements.name.value=mode==='duplicate'?`${route.name} copy`:route.name;
    autoRouteName=false;lastGeneratedRouteName='';
    fillEndpointSelect(startSelect,startSearch.value,route.start_marker_id);
    fillEndpointSelect(endSelect,endSearch.value,route.destination_marker_id);
    startSearch.value=byId(startSelect.value)?markerLabel(byId(startSelect.value)):'';
    endSearch.value=byId(endSelect.value)?markerLabel(byId(endSelect.value)):'';
    form.elements.accessibility_status.value=mode==='duplicate'?'':(route.accessibility_status===null?'':String(route.accessibility_status));
    form.elements.notes.value=route.notes||'';
    waypoints=(route.points||[]).filter(point=>point.point_type==='waypoint').map(point=>({node_id:Number(point.node_id),x:Number(point.x),y:Number(point.y),floor_number:Number(point.floor_number)||0,notes:point.notes||''}));
    undoStack=[];redoStack=[];
    $('route-save-draft').textContent=mode==='preview'?'Save Copy as Draft':'Save Private Draft';
    $('route-publish').textContent=mode==='preview'?'Publish Copy':'Publish Route';
    $('route-cancel-edit').hidden=mode==='preview';draw();
    status(mode==='preview'?'Route preview loaded. Choose Edit to change the saved record.':mode==='duplicate'?'Route copied as a private draft. Confirm the path before publishing it.':'Editing saved route. Saving replaces its waypoint order; existing shared walkways are preserved.');
    if(mode==='preview')editingId=null;
    form.scrollIntoView({behavior:'smooth',block:'start'});
  }

  $('saved-routes-list').addEventListener('click',async event=>{
    const button=event.target.closest('[data-route-action]');if(!button)return;
    const route=routes.find(item=>String(item.id)===button.dataset.id);if(!route)return;
    const action=button.dataset.routeAction;
    if(['edit','preview','duplicate'].includes(action)){loadRoute(route,action);return;}
    if(action==='delete'){
      if(!confirm(`Delete the saved route “${route.name}”? Connections used by other completed routes will remain available.`))return;
      button.disabled=true;try{await CampusApi.remove('routes',route.id);status('Saved route removed.');await refresh();}catch(error){status(error.message);}finally{button.disabled=false;}return;
    }
    if(action==='toggle'){
      const nextStatus=route.status==='active'?'inactive':'active';
      if(!confirm(`${nextStatus==='active'?'Activate':'Deactivate'} the named route “${route.name}”? Shared walkway segments remain part of the campus network.`))return;
      button.disabled=true;try{await CampusApi.request('routes',{method:'PUT',body:{id:Number(route.id),name:route.name,start_marker_id:Number(route.start_marker_id),destination_marker_id:Number(route.destination_marker_id),status:nextStatus,accessibility_status:route.accessibility_status===null?null:Number(route.accessibility_status),notes:route.notes||null,waypoints:(route.points||[]).filter(point=>point.point_type==='waypoint').map(point=>({node_id:Number(point.node_id),notes:point.notes||null}))}});status(`Route ${nextStatus}. Shared walkways remain available to shortest-path navigation.`);await refresh();}catch(error){status(error.message);}finally{button.disabled=false;}
    }
  });

  try { await refresh(); status(mapData.markers.length?'Choose endpoints and click the map to build a route.':'Add a campus map pin below before building routes.'); }
  catch(error) { status(error.message);$('saved-routes-list').innerHTML=`<p class="p-5 text-center text-xs text-red-700">${esc(error.message)}</p>`; }
});
