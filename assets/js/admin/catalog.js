document.addEventListener('DOMContentLoaded', async () => {
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const imageSrc=value=>{
    const source=String(value??'').trim();
    if(!source)return '';
    return /^(?:https?:|data:|blob:|\/)/i.test(source)?source:`../../${source.replace(/^\.\/+/, '')}`;
  };
  const categoryPage=!!document.querySelector('[data-category-form]');
  const buildingForm=document.getElementById('add-building-form');
  const facilityForm=document.getElementById('add-facility-form');
  const roomForm=document.getElementById('add-classroom-form');
  if(!categoryPage&&!buildingForm&&!facilityForm&&!roomForm)return;
  let categories=[],locations=[],rooms=[],pendingEdit=null,locationLoadError=null,roomLoadError=null;
  const searchTerms={building:'',facility:'',room:''};
  const categoryFilters={building:'',facility:'',room:''};
  const sortOrders={building:'name-asc',facility:'name-asc',room:'name-asc'};
  const pageNumbers={building:0,facility:0,room:0};
  const pageSize=12;
  const normalizeKind=value=>String(value??'').trim().toLowerCase().replace(/[ _-]+/g,' ');
  const isLocationKind=(item,kind)=>normalizeKind(item?.kind)===normalizeKind(kind);
  const refresh=async()=>{const [locationResult,roomResult,categoryResult,directoryResult]=await Promise.allSettled([CampusApi.get('locations'),CampusApi.get('rooms'),CampusApi.get('categories'),CampusApi.get('directory')]);locationLoadError=locationResult.status==='rejected'?locationResult.reason:null;roomLoadError=roomResult.status==='rejected'?roomResult.reason:null;const locationRows=locationResult.status==='fulfilled'&&Array.isArray(locationResult.value)?locationResult.value:[];const roomRows=roomResult.status==='fulfilled'&&Array.isArray(roomResult.value)?roomResult.value:[];categories=categoryResult.status==='fulfilled'&&Array.isArray(categoryResult.value)?categoryResult.value:[];const directory=directoryResult.status==='fulfilled'&&directoryResult.value?directoryResult.value:{locations:[],rooms:[]};locations=locationRows.map(item=>{const publicRecord=(directory.locations||[]).find(record=>String(record.id)===String(item.id));return {...item,image:publicRecord?.image||null,photos:publicRecord?.photos||[]};});rooms=roomRows.map(item=>{const publicRecord=(directory.rooms||[]).find(record=>String(record.id)===String(item.id));return {...item,image:publicRecord?.image||null,photos:publicRecord?.photos||[]};});if(locationLoadError)console.error('NaviGATE locations request failed:',locationLoadError);if(roomLoadError)console.error('NaviGATE rooms request failed:',roomLoadError);if(categoryResult.status==='rejected')console.warn('NaviGATE categories could not be loaded.',categoryResult.reason);if(directoryResult.status==='rejected')console.warn('NaviGATE photo directory could not be loaded.',directoryResult.reason);};
  const statusNode=()=>document.querySelector('#building-form-status,#facility-form-status,#classroom-form-status,#category-status');
  const status=message=>{const node=statusNode();if(node)node.textContent=message;};
  const notify=(message,tone='success')=>window.AdminUI?.toast(message,tone);
  const upload=async(input,type='photo')=>{const file=input?.files?.[0];if(!file)return null;const data=new FormData();data.append('file',file);data.append('type',type);return(await CampusApi.request('uploads',{method:'POST',body:data})).path;};
  const optionalText=(form,name)=>form.elements[name]?.value.trim()||null;
  const detailPayload=form=>({
    contact_email:optionalText(form,'contact_email'),
    contact_phone:optionalText(form,'contact_phone'),
    service_hours:optionalText(form,'service_hours'),
    days_open:optionalText(form,'days_open'),
    lunch_break:optionalText(form,'lunch_break'),
    accessibility_status:form.elements.accessibility_status?.value===''||!form.elements.accessibility_status?null:Number(form.elements.accessibility_status.value),
    accessibility_details:form.id==='add-building-form'?optionalText(form,'accessibility_details'):[...form.querySelectorAll('[name="accessibility_features"]:checked')].map(control=>control.value.replaceAll('_',' ')).concat(optionalText(form,'accessibility_details')||[]).filter(Boolean).join('\n')||null
  });
  const catOptions=(selected=[])=>{const ids=(Array.isArray(selected)?selected:[selected]).map(String);return categories.map(item=>`<option value="${esc(item.id)}" ${ids.includes(String(item.id))?'selected':''}>${esc(item.name)}</option>`).join('');};
  const selectedCategoryIds=form=>[...(form.querySelector('[name="category_ids"]')?.selectedOptions||[])].map(option=>Number(option.value)).filter(Number.isFinite);
  const enhanceCategoryDropdown=select=>{
    if(!select||select.dataset.dropdownEnhanced)return;
    select.dataset.dropdownEnhanced='true';select.removeAttribute('required');
    const dropdown=document.createElement('details');dropdown.className='relative w-full text-sm';
    const summary=document.createElement('summary');summary.className='flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-700 shadow-sm';
    summary.innerHTML='<span data-category-selection>Select categories</span><span class="material-symbols-rounded text-slate-500" aria-hidden="true">expand_more</span>';
    const menu=document.createElement('div');menu.className='absolute left-0 top-full z-40 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 shadow-xl';
    [...select.options].forEach(option=>{
      const label=document.createElement('label');label.className='flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm font-medium normal-case text-slate-700 hover:bg-slate-50';
      const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.value=option.value;checkbox.checked=option.selected;checkbox.className='rounded border-slate-300';
      checkbox.addEventListener('change',()=>{option.selected=checkbox.checked;updateLabel();select.dispatchEvent(new Event('change',{bubbles:true}));});
      const text=document.createElement('span');text.textContent=option.textContent;label.append(checkbox,text);menu.append(label);
    });
    const updateLabel=()=>{const selected=[...select.selectedOptions].map(option=>option.textContent);summary.querySelector('[data-category-selection]').textContent=selected.length?selected.join(', '):'Select categories';};
    dropdown.append(summary,menu);select.after(dropdown);select.hidden=true;updateLabel();
    select.form?.addEventListener('reset',()=>setTimeout(()=>{menu.querySelectorAll('input').forEach((checkbox,index)=>checkbox.checked=!!select.options[index]?.selected);updateLabel();},0));
  };
  const enhanceAccessibilityDropdown=fieldset=>{
    if(!fieldset||fieldset.dataset.dropdownEnhanced)return;
    fieldset.dataset.dropdownEnhanced='true';
    const details=document.createElement('details');details.className='admin-edit-wide relative rounded-xl border border-blue-100 bg-blue-50/60 p-3';
    const summary=document.createElement('summary');summary.className='flex cursor-pointer list-none items-center justify-between gap-3 font-bold text-slate-800';
    summary.innerHTML='<span>Accessibility features</span><span data-accessibility-selection class="text-xs font-medium text-slate-500">Select features</span>';
    const content=document.createElement('div');content.className='mt-3 grid gap-2 rounded-lg bg-white/70 p-3 sm:grid-cols-2';
    [...fieldset.children].forEach(child=>{if(child.tagName!=='LEGEND')content.append(child);});
    const updateLabel=()=>{const count=details.querySelectorAll('[name="accessibility_features"]:checked').length;summary.querySelector('[data-accessibility-selection]').textContent=count?count+' selected':'Select features';};
    details.append(summary,content);fieldset.replaceWith(details);details.addEventListener('change',updateLabel);updateLabel();
  };
  const enhanceDropdownFields=root=>{
    root.querySelectorAll('select[name="category_ids"]').forEach(enhanceCategoryDropdown);
    root.querySelectorAll('fieldset').forEach(fieldset=>{if(fieldset.querySelector('[name="accessibility_features"]'))enhanceAccessibilityDropdown(fieldset);});
  };
  const buildingOptions=(selected='')=>locations.filter(item=>isLocationKind(item,'building')).map(item=>`<option value="${esc(item.id)}" ${String(item.id)===String(selected)?'selected':''}>${esc(item.name)}</option>`).join('');

  const ensureEditor=()=>{
    if(document.getElementById('catalog-editor'))return;
    const dialog=document.createElement('dialog');dialog.id='catalog-editor';dialog.className='admin-edit-dialog';
    dialog.innerHTML='<form id="catalog-editor-form" method="dialog" novalidate><div class="admin-edit-dialog-heading"><div><h2 id="catalog-editor-title">Edit campus record</h2><p>Update the fields below, then save your changes.</p></div><button type="button" data-editor-close class="admin-icon-button" aria-label="Close editor" title="Close editor"><span class="material-symbols-rounded" aria-hidden="true">close</span></button></div><div id="catalog-editor-fields" class="admin-edit-fields"></div><p id="catalog-editor-status" class="min-h-5 text-xs" role="status" aria-live="polite"></p><div class="admin-edit-actions"><button type="button" data-editor-close class="admin-button-secondary">Cancel</button><button type="submit" class="admin-button-primary">Save changes</button></div></form>';
    document.body.append(dialog);
    const form=dialog.querySelector('form');
    const requestClose=async()=>{if(form.dataset.dirty==='true'&&!await window.AdminUI.confirm({title:'Discard unsaved changes?',message:'Your edits will be lost if you close this form.',confirmLabel:'Discard changes',danger:true}))return;form.dataset.dirty='false';dialog.close();};
    form.addEventListener('input',()=>{form.dataset.dirty='true';});form.addEventListener('change',()=>{form.dataset.dirty='true';});
    dialog.querySelectorAll('[data-editor-close]').forEach(button=>button.addEventListener('click',requestClose));
    dialog.addEventListener('cancel',event=>{event.preventDefault();requestClose();});
    dialog.addEventListener('click',event=>{if(event.target===dialog)requestClose();});
    dialog.addEventListener('click',manageGalleryAction);
    dialog.querySelector('form').addEventListener('submit',saveEditor);
  };
  const field=(label,name,value,type='text',required=false,extra='')=>`<label>${label}${required?' <span class="text-red-600" aria-label="required">*</span>':''}<input name="${name}" type="${type}" value="${esc(value)}" ${required?'required':''} ${extra}></label>`;
  const selectField=(label,name,options,selected,required=true)=>`<label>${label}${required?' <span class="text-red-600" aria-label="required">*</span>':''}<select name="${name}" ${required?'required':''}>${options}</select></label>`;
  const multiSelectField=(label,name,options,selected=[])=>`<div class="admin-edit-wide grid gap-1"><span class="font-semibold text-slate-700">${label} <span class="text-red-600" aria-label="required">*</span></span><select name="${name}" multiple size="${Math.min(6,Math.max(3,categories.length))}" class="catalog-multi-category">${catOptions(selected)}</select><small class="block text-slate-500">Choose one or more categories from the dropdown.</small></div>`;
  const areaField=(label,name,value,max=1000)=>`<label class="admin-edit-wide">${label}<textarea name="${name}" rows="2" maxlength="${max}">${esc(value||'')}</textarea></label>`;
  const accessibilityFeatureOptions=[
    ['wheelchair_entrance','Wheelchair-accessible entrance'],['elevator','Elevator'],['ramp','Ramp'],
    ['accessible_restroom','Accessible restroom'],['accessible_parking','Accessible parking'],['handrails','Handrails'],
    ['tactile_paving','Tactile paving'],['braille_signage','Braille signage'],['hearing_assistance','Hearing assistance']
  ];
  const accessibilityFeatureFields=selected=>`<fieldset class="admin-edit-wide rounded-xl border border-blue-100 bg-blue-50/60 p-4"><legend class="px-1 font-bold">Accessibility features</legend><p class="mb-3 text-xs text-slate-500">Select the accessibility features confirmed for this location.</p><div class="grid gap-2 sm:grid-cols-2">${accessibilityFeatureOptions.map(([value,label])=>`<label class="flex items-center gap-2 text-xs"><input type="checkbox" name="accessibility_features" value="${value}" ${selected.includes(value)?'checked':''}>${label}</label>`).join('')}</div></fieldset>`;
  const serviceHourOptions=['Select service hours','8:00 AM – 5:00 PM','8:00 AM – 12:00 PM','1:00 PM – 5:00 PM','7:00 AM – 4:00 PM','24 hours','By appointment','Varies'];
  const dayOptions=['Select days open','Monday – Friday','Monday – Saturday','Monday – Sunday','Weekdays only','Weekends only','By appointment','Closed'];
  const lunchOptions=['Select lunch hours','12:00 PM – 1:00 PM','12:00 PM – 12:30 PM','12:00 PM – 1:30 PM','No lunch break','Varies'];
  const floorOptions=['Ground Level','2nd Floor','3rd Floor','4th Floor','5th Floor','6th Floor','7th Floor','8th Floor','9th Floor','10th Floor','Basement'];
  const presetField=(label,name,options,value)=>selectField(label,name,options.map((option,index)=>`<option value="${index===0?'':esc(option)}" ${value===option?'selected':''}>${esc(option)}</option>`).join('')+(value&&!options.includes(value)?`<option selected value="${esc(value)}">${esc(value)}</option>`:''),value||'',false);
  const extraLocationFields=item=>field('Contact email','contact_email',item.contact_email||'','email',false,'maxlength="254"')+
    field('Contact phone','contact_phone',item.contact_phone||'','tel',false,'maxlength="40"')+
    presetField('Service hours','service_hours',serviceHourOptions,item.service_hours)+
    presetField('Days open','days_open',dayOptions,item.days_open)+
    presetField('Lunch hours','lunch_break',lunchOptions,item.lunch_break)+
    selectField('Accessibility information','accessibility_status','<option value="">Not recorded</option><option value="1">Accessible</option><option value="0">Not accessible</option>',item.accessibility_status===null||item.accessibility_status===undefined?'':String(item.accessibility_status),false)+
    areaField('Accessibility features (one per line)','accessibility_details',item.accessibility_details,1000);
  const extraRoomFields=item=>field('Contact email','contact_email',item.contact_email||'','email',false,'maxlength="254"')+
    field('Contact phone','contact_phone',item.contact_phone||'','tel',false,'maxlength="40"')+
    presetField('Service hours','service_hours',serviceHourOptions,item.service_hours)+
    presetField('Days open','days_open',dayOptions,item.days_open)+
    presetField('Lunch hours','lunch_break',lunchOptions,item.lunch_break)+
    selectField('Accessibility information','accessibility_status','<option value="">Not recorded</option><option value="1">Accessible</option><option value="0">Not accessible</option>',item.accessibility_status===null||item.accessibility_status===undefined?'':String(item.accessibility_status),false)+
    areaField('Accessibility features (one per line)','accessibility_details',item.accessibility_details,1000);
  function galleryMarkup(type,item){
    const ownerType=type==='location'?'location':'room';
    const photos=item.photos||[];
    return `<section class="admin-edit-wide" data-gallery-owner="${ownerType}" data-gallery-id="${esc(item.id)}"><h3 class="font-bold">Photo gallery</h3><p class="text-xs text-slate-500">Upload and manage campus photos.</p><div class="mt-3 grid gap-2">${photos.map(photo=>`<div class="rounded-lg border p-3" data-photo-id="${esc(photo.id)}"><img src="${esc(imageSrc(photo.image))}" alt="" class="mb-2 h-24 w-full rounded object-cover"><label class="mt-2 block">Caption<input data-photo-caption maxlength="255" value="${esc(photo.caption||'')}"></label><label class="mt-2 flex items-center gap-2"><input type="checkbox" data-photo-cover ${Number(photo.isCover)?'checked':''}> Use as cover photo</label><div class="mt-2 flex gap-2"><button type="button" data-photo-save class="admin-button-secondary">Save photo details</button><button type="button" data-photo-delete class="admin-button-secondary">Remove photo</button></div></div>`).join('')||'<p class="text-xs text-slate-500">No gallery photos have been added.</p>'}</div><div class="mt-3 grid gap-2"><label>New photo<input type="file" data-gallery-file accept="image/png,image/jpeg,image/webp"></label><label>Caption<input data-gallery-caption maxlength="255"></label><button type="button" data-photo-add class="admin-button-primary">Upload photo</button></div></section>`;
  }
  async function manageGalleryAction(event){
    const button=event.target.closest('[data-photo-add],[data-photo-save],[data-photo-delete]');if(!button)return;
    const section=button.closest('[data-gallery-owner]'),card=button.closest('[data-photo-id]'),status=document.getElementById('catalog-editor-status');
    if(!section)return;
    button.disabled=true;
    try{
      if(button.hasAttribute('data-photo-add')){
        const fileInput=section.querySelector('[data-gallery-file]'),captionInput=section.querySelector('[data-gallery-caption]');
        if(!fileInput.files?.length){status.textContent='Choose a photo to upload.';return;}
        const image_path=await upload(fileInput);
        await CampusApi.request('facility-photos',{method:'POST',body:{owner_type:section.dataset.galleryOwner,owner_id:Number(section.dataset.galleryId),image_path,alt_text:captionInput.value.trim()||'Campus photo',caption:captionInput.value.trim()||null}});
        status.textContent='Photo added to the gallery.';
      }else if(button.hasAttribute('data-photo-save')){
        const caption=card.querySelector('[data-photo-caption]').value.trim()||null;
        await CampusApi.request('facility-photos',{method:'PUT',body:{id:Number(card.dataset.photoId),caption, is_cover:card.querySelector('[data-photo-cover]').checked,sort_order:0}});
        status.textContent='Photo details saved.';
      }else{
        if(!await window.AdminUI.confirm({title:'Remove gallery photo?',message:'This removes the photo from the saved campus gallery. The building or room record will remain.',confirmLabel:'Remove photo',danger:true}))return;
        await CampusApi.remove('facility-photos',Number(card.dataset.photoId));status.textContent='Photo removed from the gallery.';
      }
      await refresh();const item=section.dataset.galleryOwner==='location'?locations.find(row=>String(row.id)===section.dataset.galleryId):rooms.find(row=>String(row.id)===section.dataset.galleryId);
      if(item)section.outerHTML=galleryMarkup(section.dataset.galleryOwner==='location'?'location':'room',item);
    }catch(error){status.textContent=error.message;}finally{button.disabled=false;}
  }
  function openEditor(type,item){
    ensureEditor();pendingEdit={type,item};
    const dialog=document.getElementById('catalog-editor'),fields=document.getElementById('catalog-editor-fields');
    const selectedCategoryIds=Array.isArray(item.category_ids)&&item.category_ids.length?item.category_ids:[item.category_id||categories.find(category=>category.name===item.category)?.id].filter(Boolean);
    if(type==='location'){
      document.getElementById('catalog-editor-title').textContent=item.kind==='building'?'Edit building':'Edit facility';
      fields.innerHTML=field('Name','name',item.name,'text',true,'maxlength="150"')+
        multiSelectField('Categories','category_ids',null,selectedCategoryIds)+
        (item.kind==='building'?field('Building number','building_number',item.building_number||'','text',false,'maxlength="40"')+field('Number of floors','floor_count',item.floor_count||1,'number',true,'min="1" max="100"'):selectField('Associated building','parent_building_id','<option value="">No building selected</option>'+buildingOptions(item.parent_building_id),item.parent_building_id,false)+presetField('Floor level','floor_label',floorOptions,item.floor_label||''))+
        field('Capacity','capacity',item.capacity??'','number',false,'min="0"')+
        '<label class="admin-edit-wide">Description<textarea name="description" rows="4" maxlength="4000">'+esc(item.description||'')+'</textarea></label>'+
        accessibilityFeatureFields(item.accessibility_features||String(item.accessibility_details||'').split(/\r?\n/).map(value=>value.trim().replaceAll(' ','_')))+extraLocationFields(item)+`<label class="admin-edit-wide catalog-model-field">${item.kind==='building'?'3D Building Model':'3D Facility Model'} (.glb)<input name="model_3d_file" type="file" accept=".glb,model/gltf-binary,application/octet-stream"><small>Optional GLB model, maximum 100 MB. ${item.model_3d_url?'Upload a new file to replace the current model.':'No 3D model uploaded yet.'}</small></label>`+galleryMarkup(type,item);
    }else if(type==='room'){
      document.getElementById('catalog-editor-title').textContent='Edit room or office';
      fields.innerHTML=field('Room name','name',item.name,'text',true,'maxlength="150"')+
        field('Room number','room_number',item.room_number,'text',true,'maxlength="50"')+
        selectField('Building','building_id','<option value="">Select a building</option>'+buildingOptions(item.building_id),item.building_id)+
        multiSelectField('Categories','category_ids',null,selectedCategoryIds)+
        presetField('Floor level','floor_label',floorOptions,item.floor_label||'')+
        field('Maximum capacity','capacity',item.capacity??'','number',false,'min="0"')+
        '<label class="admin-edit-wide">Description<textarea name="description" rows="3" maxlength="4000">'+esc(item.description||'')+'</textarea></label>'+ 
        field('Contact information','contact_info',item.contact_info||'','text',false,'maxlength="180"')+accessibilityFeatureFields(String(item.accessibility_details||'').split(/\r?\n/).map(value=>value.trim().replaceAll(' ','_')))+extraRoomFields(item)+galleryMarkup(type,item);
    }

    enhanceDropdownFields(fields);
    document.getElementById('catalog-editor-form').dataset.dirty='false';
    document.getElementById('catalog-editor-status').textContent='';
    dialog.showModal();dialog.querySelector('input,select,textarea')?.focus();
  }
  function showDetails(item,type){
    let dialog=document.getElementById('catalog-details');
    if(!dialog){
      dialog=document.createElement('dialog');dialog.id='catalog-details';dialog.className='admin-edit-dialog';
      dialog.innerHTML='<div class="admin-edit-dialog-heading"><div><h2 data-details-title>Record details</h2><p>Current information saved in the campus database.</p></div><button type="button" data-details-close class="admin-icon-button" aria-label="Close details" title="Close details"><span class="material-symbols-rounded" aria-hidden="true">close</span></button></div><div class="admin-details-content" data-details-content></div><div class="admin-edit-actions"><button type="button" data-details-close class="admin-button-secondary">Close</button></div>';
      document.body.append(dialog);dialog.querySelectorAll('[data-details-close]').forEach(button=>button.addEventListener('click',()=>dialog.close()));dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
    }
    const title=type==='room'?'Room':type==='building'?'Building':'Facility';
    dialog.querySelector('[data-details-title]').textContent=`${title}: ${item.name}`;
    const preferred=['name','category','building_number','building_name','room_number','floor_label','floor_count','capacity','contact_info','contact_email','contact_phone','service_hours','days_open','lunch_break','description','accessibility_status','accessibility_details','accessibility_features'];
    const labels={name:'Name',category:'Category',building_number:'Building code',building_name:'Building',room_number:'Room number',floor_label:'Floor level',floor_count:'Floors',capacity:'Capacity',contact_info:'Contact information',contact_email:'Email',contact_phone:'Phone',service_hours:'Service hours',days_open:'Days open',lunch_break:'Lunch hours',description:'Description',accessibility_status:'Accessibility',accessibility_details:'Accessibility features',accessibility_features:'Accessibility features'};
    const entries=preferred.filter(key=>item[key]!==null&&item[key]!==undefined&&item[key]!=='').map(key=>{
      const raw=item[key],value=Array.isArray(raw)?raw.map(part=>String(part).replaceAll('_',' ')).join(', '):key==='accessibility_status'?(Number(raw)?'Accessible':'Not accessible'):String(raw);
      return `<div><dt>${esc(labels[key]||key)}</dt><dd>${esc(value)}</dd></div>`;
    });
    const gallery=(item.photos||[]).filter(photo=>photo.image);
    const photo=item.image||gallery.find(photo=>Number(photo.isCover))?.image||gallery[0]?.image||item.image_path;
    dialog.querySelector('[data-details-content]').innerHTML=`${photo?`<img class="admin-details-photo" src="${esc(imageSrc(photo))}" alt="${esc(item.name)}">`:''}${item.model_3d_url?`<section class="my-4"><h3 class="mb-2 font-bold">3D Model</h3><model-viewer src="${esc(item.model_3d_url)}" alt="3D model of ${esc(item.name)}" camera-controls auto-rotate shadow-intensity="1" style="width:100%;height:360px;background:#f1f5f9;border-radius:14px"></model-viewer></section>`:''}<dl class="admin-details-grid">${entries.join('')||'<p class="admin-empty-state">No additional details are saved for this record.</p>'}</dl>`;
    dialog.showModal();
  }
  async function saveEditor(event){
    event.preventDefault();const form=event.currentTarget,button=form.querySelector('[type="submit"]'),message=document.getElementById('catalog-editor-status');
    if(!form.reportValidity())return;if(!selectedCategoryIds(form).length){message.textContent='Select at least one category.';return;}button.disabled=true;message.textContent='Saving changes…';
    const data=new FormData(form),value=name=>String(data.get(name)||'').trim(),item=pendingEdit.item;
    try{
      if(pendingEdit.type==='location'){
        const isBuilding=item.kind==='building';
        const accessibilityFeatures=[...form.querySelectorAll('[name="accessibility_features"]:checked')].map(control=>control.value);
        const uploadedModel=await upload(form.querySelector('[name="model_3d_file"]'),'model');
        await CampusApi.save('locations',{model_3d_path:uploadedModel||item.model_3d_object_path||item.model_3d_path||null,name:value('name'),kind:item.kind,category_ids:selectedCategoryIds(form),description:value('description')||null,building_number:isBuilding?(value('building_number')||null):(item.building_number||null),floor_label:isBuilding?null:(value('floor_label')||null),floor_count:isBuilding?Number(value('floor_count')||item.floor_count||1):1,parent_building_id:isBuilding?null:(value('parent_building_id')||null),capacity:value('capacity')===''?null:Number(value('capacity')),image_path:item.image_object_path||null,department_name:item.department_name||null,contact_email:value('contact_email')||null,contact_phone:value('contact_phone')||null,website_url:item.website_url||null,service_hours:value('service_hours')||null,days_open:value('days_open')||null,lunch_break:value('lunch_break')||null,services:item.services||null,nearby_landmarks:item.nearby_landmarks||null,accessibility_status:value('accessibility_status')===''?null:Number(value('accessibility_status')),accessibility_details:isBuilding?(value('accessibility_details')||null):[...accessibilityFeatures.map(feature=>feature.replaceAll('_',' ')),value('accessibility_details')].filter(Boolean).join('\n')||null,accessibility_features:isBuilding?accessibilityFeatures:[]},item.id);
      }else{
        const floorLabel=value('floor_label');
        await CampusApi.save('rooms',{name:value('name'),room_number:value('room_number'),route_node_id:item.route_node_id||null,building_id:Number(value('building_id')),category_ids:selectedCategoryIds(form),floor_label:floorLabel||null,floor_number:Number((floorLabel.match(/\d+/)||[])[0]||item.floor_number||0),capacity:value('capacity')===''?null:Number(value('capacity')),description:value('description')||null,function_description:item.function_description||null,department_head:item.department_head||null,contact_info:value('contact_info')||null,image_path:item.image_path||null,department_name:item.department_name||null,contact_email:value('contact_email')||null,contact_phone:value('contact_phone')||null,website_url:item.website_url||null,service_hours:value('service_hours')||null,days_open:value('days_open')||null,lunch_break:value('lunch_break')||null,services:item.services||null,nearby_landmarks:item.nearby_landmarks||null,accessibility_status:value('accessibility_status')===''?null:Number(value('accessibility_status')),accessibility_details:[...form.querySelectorAll('[name="accessibility_features"]:checked')].map(control=>control.value.replaceAll('_',' ')).concat(value('accessibility_details')||[]).filter(Boolean).join('\n')||null},item.id);
      }
      form.dataset.dirty='false';await refresh();renderAll();
      const savedItem=pendingEdit.type==='location'
        ?locations.find(record=>String(record.id)===String(item.id))
        :rooms.find(record=>String(record.id)===String(item.id));
      if(!savedItem)throw new Error('The record was saved, but could not be reloaded. Refresh the page to verify the latest information.');
      if(pendingEdit.type==='location'&&JSON.stringify((savedItem.category_ids||[]).map(Number).sort())!==JSON.stringify(selectedCategoryIds(form).sort()))throw new Error('The record was saved, but its selected categories did not match. Please try again.');
      pendingEdit.item=savedItem;
      const recordLabel=pendingEdit.type==='location'?(item.kind==='building'?'Building':'Facility'):'Room';
      const selectedCategory=(savedItem.category_names||[]).join(', ')||categories.find(category=>String(category.id)===String(savedItem.category_id))?.name;
      message.textContent=`${recordLabel} updated successfully.${selectedCategory?` Category: ${selectedCategory}.`:''}`;
      status(message.textContent);notify(message.textContent);
    }catch(error){message.textContent=error.message;notify(error.message,'error');}finally{button.disabled=false;}
  }
  const listToolbar=(kind,label,count)=>`<div class="admin-list-toolbar"><div><h2>${label}</h2><p>${count} record${count===1?'':'s'}</p></div><div class="admin-list-controls"><label class="admin-search"><span class="material-symbols-rounded" aria-hidden="true">search</span><span class="sr-only">Search ${label.toLowerCase()}</span><input type="search" data-list-search="${kind}" value="${esc(searchTerms[kind])}" placeholder="Search ${label.toLowerCase()}" autocomplete="off"></label><label class="admin-filter-label">Category<select data-category-filter="${kind}"><option value="">All categories</option>${categories.map(category=>`<option value="${esc(category.name)}" ${categoryFilters[kind]===category.name?'selected':''}>${esc(category.name)}</option>`).join('')}</select></label><label class="admin-filter-label">Sort<select data-sort-order="${kind}"><option value="name-asc" ${sortOrders[kind]==='name-asc'?'selected':''}>Name A to Z</option><option value="name-desc" ${sortOrders[kind]==='name-desc'?'selected':''}>Name Z to A</option></select></label></div></div>`;
  const pagination=(kind,total)=>{
    const pageCount=Math.ceil(total/pageSize);if(pageCount<2)return '';
    const page=pageNumbers[kind];const first=page*pageSize+1,last=Math.min(total,(page+1)*pageSize);
    return `<nav class="admin-pagination" aria-label="${kind} list pages"><span>Showing ${first}–${last} of ${total}</span><div><button type="button" data-page="previous" ${page===0?'disabled':''}>Previous</button><button type="button" data-page="next" ${page>=pageCount-1?'disabled':''}>Next</button></div></nav>`;
  };
  const bindPagination=(target,kind,total)=>target.querySelectorAll('[data-page]').forEach(button=>button.addEventListener('click',()=>{pageNumbers[kind]+=button.dataset.page==='next'?1:-1;pageNumbers[kind]=Math.max(0,Math.min(pageNumbers[kind],Math.ceil(total/pageSize)-1));kind==='room'?renderRooms():renderLocations(kind);}));
  const emptyState=(label,filtered)=>`<div class="catalog-directory-empty"><span class="material-symbols-rounded" aria-hidden="true">${filtered?'search_off':'location_city'}</span><h3>${filtered?'No matching records':`No ${label.toLowerCase()} yet`}</h3><p>${filtered?`Try another search to find ${label.toLowerCase()}.`:`Add a ${label.replace(/s$/,'').toLowerCase()} above to see it in this directory.`}</p></div>`;
  const catalogCards=(rows,kind)=>`<div class="catalog-list-cards ${kind==='building'||kind==='room'||kind==='facility'?'catalog-list-rows':''}">${rows.map(item=>{
    const room=kind==='room',building=kind==='building';
    const gallery=(item.photos||[]).filter(entry=>entry.image);
    const parent=room?item.building_name:building?`${item.floor_count||1} floor${Number(item.floor_count)===1?'':'s'}`:locations.find(location=>String(location.id)===String(item.parent_building_id))?.name||'Building not assigned';
    const photo=item.photos?.find(entry=>Number(entry.isCover))||item.photos?.[0];
    const image=item.image||photo?.image||item.image_path;
    const kindLabel=room?'Room':building?'Building':'Facility';
    const detailHref=room?`../office.html?id=${encodeURIComponent(item.id)}`:`../building.html?id=${encodeURIComponent(item.id)}`;
    const mapHref=`../map.html?search=${encodeURIComponent(item.name)}`;
    const subtitle=room?`${parent||'Building unavailable'} · ${item.floor_label||'Floor unavailable'} · Room ${item.room_number||'—'}`:building?parent:`Located in ${parent}`;
    return `<article class="catalog-directory-card" data-id="${esc(item.id)}">
      <div class="catalog-directory-photo">${image?`<a href="${esc(imageSrc(image))}" target="_blank" rel="noopener noreferrer" aria-label="Open cover photo of ${esc(item.name)}"><img src="${esc(imageSrc(image))}" alt="" loading="lazy"></a>`:`<span class="material-symbols-rounded" aria-hidden="true">${room?'meeting_room':building?'location_city':'storefront'}</span>`}${gallery.length>1?`<div class="catalog-photo-strip" aria-label="${gallery.length} campus photos">${gallery.map((entry,index)=>`<a href="${esc(imageSrc(entry.image))}" target="_blank" rel="noopener noreferrer" aria-label="Open photo ${index+1} of ${esc(item.name)}"><img src="${esc(imageSrc(entry.image))}" alt="${esc(entry.altText||entry.caption||item.name+' photo '+(index+1))}" loading="lazy"></a>`).join('')}</div>`:''}</div>
      <div class="catalog-directory-info"><div class="catalog-directory-meta"><span>${kindLabel}</span><span>${esc((item.category_names||[item.category]).filter(Boolean).join(' · ')||'Campus')}</span></div><h3>${esc(item.name)}</h3><p class="catalog-directory-description">${esc(item.description||'More information is available in this directory profile.')}</p><p class="catalog-directory-location">${esc(subtitle)}</p></div>
      <div class="catalog-directory-actions"><a href="${mapHref}"><span class="material-symbols-rounded" aria-hidden="true">map</span><span>Show on map</span></a><a href="${detailHref}"><span>Public page</span><span class="material-symbols-rounded" aria-hidden="true">arrow_forward</span></a><span class="catalog-row-action-group"><button data-action="details" class="admin-row-action">View details</button><button data-action="edit" class="admin-row-action">Edit</button><button data-action="archive" class="admin-row-action is-danger">Archive</button></span></div>
    </article>`;
  }).join('')}</div>`;
  function renderLocations(kind){
    const target=document.getElementById(kind==='building'?'buildings-list':'facilities-list');if(!target)return;if(locationLoadError){target.innerHTML=`<div class="p-5 text-center text-sm text-red-700"><strong>Could not load ${kind==='building'?'buildings':'facilities'}.</strong><p class="mt-1">${esc(locationLoadError.message||'The campus API request failed.')}</p><button type="button" class="mt-3 underline" onclick="location.reload()">Retry</button></div>`;return;}
    const term=searchTerms[kind].toLocaleLowerCase();const all=locations.filter(item=>isLocationKind(item,kind)&&item.active!==false);const filtered=all.filter(item=>`${item.name} ${item.category||''} ${item.building_number||''}`.toLocaleLowerCase().includes(term)&&(!categoryFilters[kind]||(item.category_names||[item.category]).includes(categoryFilters[kind]))).sort((a,b)=>sortOrders[kind]==='name-desc'?b.name.localeCompare(a.name):a.name.localeCompare(b.name));
    pageNumbers[kind]=Math.max(0,Math.min(pageNumbers[kind],Math.max(0,Math.ceil(filtered.length/pageSize)-1)));const rows=filtered.slice(pageNumbers[kind]*pageSize,(pageNumbers[kind]+1)*pageSize);
    target.innerHTML=listToolbar(kind,kind==='building'?'Buildings':'Facilities',filtered.length)+(rows.length?catalogCards(rows,kind):emptyState(kind==='building'?'buildings':'facilities',!!term||!!categoryFilters[kind]))+pagination(kind,filtered.length);
    target.querySelector('[data-list-search]')?.addEventListener('input',event=>{const cursor=event.target.selectionStart;searchTerms[kind]=event.target.value;pageNumbers[kind]=0;renderLocations(kind);const input=target.querySelector('[data-list-search]');input.focus();input.setSelectionRange(cursor,cursor);});
    target.querySelector('[data-category-filter]')?.addEventListener('change',event=>{categoryFilters[kind]=event.target.value;pageNumbers[kind]=0;renderLocations(kind);});
    target.querySelector('[data-sort-order]')?.addEventListener('change',event=>{sortOrders[kind]=event.target.value;pageNumbers[kind]=0;renderLocations(kind);});
    bindPagination(target,kind,filtered.length);
    target.querySelector('.catalog-list-cards')?.addEventListener('click',async event=>{const button=event.target.closest('[data-action]');if(!button)return;const item=all.find(record=>String(record.id)===button.closest('[data-id]').dataset.id);if(!item)return;if(button.dataset.action==='details'){showDetails(item,kind);return;}if(button.dataset.action==='edit'){openEditor('location',item);return;}if(button.dataset.action==='archive'&&!await window.AdminUI.confirm({title:`Archive ${kind}?`,message:`Archive “${item.name}”? It will no longer appear in active campus records. Related records are not automatically deleted; the server will enforce relationship rules.`,confirmLabel:'Archive record',danger:true}))return;button.disabled=true;
      try{await CampusApi.request('locations',{method:'PATCH',body:{id:item.id,active:false}});status('Campus record archived.');notify(`${kind[0].toUpperCase()+kind.slice(1)} archived.`);await refresh();renderAll();
      }catch(error){status(error.message);notify(error.message,'error');}finally{button.disabled=false;}
    });
  }
  function renderRooms(){
    const target=document.getElementById('classrooms-list');if(!target)return;if(roomLoadError){target.innerHTML=`<div class="p-5 text-center text-sm text-red-700"><strong>Could not load rooms and offices.</strong><p class="mt-1">${esc(roomLoadError.message||'The campus API request failed.')}</p><button type="button" class="mt-3 underline" onclick="location.reload()">Retry</button></div>`;return;}const term=searchTerms.room.toLocaleLowerCase();
    const filtered=rooms.filter(room=>room.active!==false&&`${room.name} ${room.room_number} ${room.building_name} ${room.floor_label||''}`.toLocaleLowerCase().includes(term)&&(!categoryFilters.room||(room.category_names||[room.category]).includes(categoryFilters.room))).sort((a,b)=>sortOrders.room==='name-desc'?b.name.localeCompare(a.name):a.name.localeCompare(b.name));
    pageNumbers.room=Math.max(0,Math.min(pageNumbers.room,Math.max(0,Math.ceil(filtered.length/pageSize)-1)));const rows=filtered.slice(pageNumbers.room*pageSize,(pageNumbers.room+1)*pageSize);
    target.innerHTML=listToolbar('room','Rooms and offices',filtered.length)+(rows.length?catalogCards(rows,'room'):emptyState('rooms',!!term||!!categoryFilters.room))+pagination('room',filtered.length);
    target.querySelector('[data-list-search]')?.addEventListener('input',event=>{const cursor=event.target.selectionStart;searchTerms.room=event.target.value;pageNumbers.room=0;renderRooms();const input=target.querySelector('[data-list-search]');input.focus();input.setSelectionRange(cursor,cursor);});
    target.querySelector('[data-category-filter]')?.addEventListener('change',event=>{categoryFilters.room=event.target.value;pageNumbers.room=0;renderRooms();});
    target.querySelector('[data-sort-order]')?.addEventListener('change',event=>{sortOrders.room=event.target.value;pageNumbers.room=0;renderRooms();});
    bindPagination(target,'room',filtered.length);
    target.querySelector('.catalog-list-cards')?.addEventListener('click',async event=>{const button=event.target.closest('[data-action]');if(!button)return;const item=rooms.find(room=>String(room.id)===button.closest('[data-id]').dataset.id);if(!item)return;if(button.dataset.action==='details'){showDetails(item,'room');return;}if(button.dataset.action==='edit'){openEditor('room',item);return;}if(button.dataset.action==='archive'&&!await window.AdminUI.confirm({title:'Archive room?',message:`Archive room ${item.room_number} — ${item.name}? Related map and route records will not be automatically removed.`,confirmLabel:'Archive room',danger:true}))return;button.disabled=true;
      try{if(button.dataset.action==='archive'){await CampusApi.request('rooms',{method:'PATCH',body:{id:item.id,active:false}});status('Room archived.');notify('Room archived successfully.');}await refresh();renderAll();
      }catch(error){status(error.message);notify(error.message,'error');}finally{button.disabled=false;}
    });
  }
  function renderCategories(){
    const target=document.getElementById('categories-list');if(!target)return;
    const count=document.getElementById('category-count');if(count)count.textContent=`${categories.length} ${categories.length===1?'category':'categories'}`;
    target.innerHTML=categories.length?categories.map((item,index)=>`<div class="category-list-row" data-id="${esc(item.id)}"><span class="category-list-number">${String(index+1).padStart(2,'0')}</span><span class="category-list-name">${esc(item.name)}</span><div class="category-list-actions"><button data-action="edit" class="admin-row-action">Rename</button><button data-action="delete" class="admin-row-action is-danger">Remove</button></div></div>`).join(''):'<p class="p-5 text-center text-xs text-slate-500">No categories have been added yet.</p>';
    target.onclick=async event=>{const button=event.target.closest('[data-action]');if(!button)return;const row=button.closest('[data-id]');const item=categories.find(record=>String(record.id)===row?.dataset.id);if(!item)return;
      if(button.dataset.action==='edit'){row.querySelector('.category-list-name').outerHTML=`<label class="sr-only" for="category-edit-${esc(item.id)}">Category name</label><input id="category-edit-${esc(item.id)}" maxlength="80" value="${esc(item.name)}">`;row.querySelector('.category-list-actions').innerHTML='<button data-action="save" class="admin-row-action">Save</button><button data-action="cancel" class="admin-row-action">Cancel</button>';row.querySelector('input').focus();return;}
      if(button.dataset.action==='cancel'){renderCategories();return;}
      try{if(button.dataset.action==='delete'){if(!await window.AdminUI.confirm({title:'Remove category?',message:`Remove “${item.name}”? This is only allowed when no campus records use this category.`,confirmLabel:'Remove category',danger:true}))return;await CampusApi.remove('categories',item.id);}else if(button.dataset.action==='save'){const name=row.querySelector('input').value.trim();if(!name){status('Enter a category name.');return;}await CampusApi.save('categories',{name},item.id);}await refresh();renderCategories();status('Category changes saved.');notify('Category changes saved.');}catch(error){status(error.message);notify(error.message,'error');}
    };
  }
  function renderAll(){renderLocations('building');renderLocations('facility');renderRooms();renderCategories();}
  try{
    await refresh();
    document.querySelectorAll('[data-catalog-add-panel]').forEach(panel=>panel.hidden=false);
    if(categoryPage){renderCategories();document.querySelectorAll('[data-category-form]').forEach(form=>form.addEventListener('submit',async event=>{event.preventDefault();const button=form.querySelector('[type="submit"]');button.disabled=true;try{await CampusApi.save('categories',{name:form.elements.category.value.trim()});await refresh();renderCategories();form.reset();status('Category saved.');}catch(error){status(error.message);}finally{button.disabled=false;}}));return;}
    for(const form of [buildingForm,facilityForm,roomForm].filter(Boolean)){
      if(form.elements.category_ids)form.elements.category_ids.innerHTML=catOptions([]);
      if(form.elements.buildingId)form.elements.buildingId.innerHTML=buildingOptions();
      const preview=form.querySelector('[data-photo-preview]');if(form.elements.photo&&preview)window.CampusPhotoTools?.bindPreview(form.elements.photo,preview);
      enhanceDropdownFields(form);
      const kind=form===buildingForm?'building':form===facilityForm?'facility':'room';
      const formDialog=window.AdminUI?.mountFormDialog(form,{title:`Add ${kind}`,description:'Enter the campus information below. Required fields are marked in the form.',triggerLabel:`Add ${kind}`});
      form.addEventListener('submit',async event=>{event.preventDefault();if(!selectedCategoryIds(form).length){status('Select at least one category.');return;}const button=form.querySelector('[type="submit"]');button.disabled=true;status('Saving to the campus database…');
        try{const image_path=await upload(form.elements.photo);let payload,resource;
          if(form===buildingForm){resource='locations';const model_3d_path=await upload(form.elements.model_3d_file,'model');payload={model_3d_path,name:form.elements.name.value.trim(),kind:'building',category_ids:selectedCategoryIds(form),description:optionalText(form,'description'),building_number:optionalText(form,'building_number'),floor_count:Number(form.elements.floors.value),capacity:form.elements.capacity.value===''?null:Number(form.elements.capacity.value),image_path,...detailPayload(form),accessibility_features:[...form.querySelectorAll('[name="accessibility_features"]:checked')].map(control=>control.value)};}
          else if(form===facilityForm){resource='locations';const model_3d_path=await upload(form.elements.model_3d_file,'model');payload={model_3d_path,name:form.elements.name.value.trim(),kind:'facility',category_ids:selectedCategoryIds(form),parent_building_id:form.elements.buildingId.value||null,floor_label:optionalText(form,'floor'),description:optionalText(form,'description'),floor_count:1,capacity:form.elements.capacity.value===''?null:Number(form.elements.capacity.value),image_path,...detailPayload(form)};}
          else{resource='rooms';payload={name:form.elements.name.value.trim(),building_id:Number(form.elements.buildingId.value),category_ids:selectedCategoryIds(form),room_number:form.elements.room.value.trim(),floor_label:form.elements.floor.value.trim(),floor_number:Number((form.elements.floor.value.match(/\d+/)||[])[0]||0),capacity:form.elements.capacity.value===''?null:Number(form.elements.capacity.value),department_head:optionalText(form,'head'),contact_info:optionalText(form,'contact'),description:optionalText(form,'description'),function_description:optionalText(form,'function_description'),image_path,...detailPayload(form)};}
          await CampusApi.save(resource,payload);await refresh();renderAll();form.reset();if(form.elements.floors)form.elements.floors.value='1';if(form.elements.floor)form.elements.floor.value='Ground Level';if(form.elements.capacity)form.elements.capacity.value='0';formDialog?.close();status('Saved to the campus database.');notify(`${kind[0].toUpperCase()+kind.slice(1)} added successfully.`);
        }catch(error){status(error.message);notify(error.message,'error');}finally{button.disabled=false;}
      });
    }
    renderAll();
  }catch(error){status(error.message);const target=document.getElementById('buildings-list')||document.getElementById('facilities-list')||document.getElementById('classrooms-list');if(target)target.innerHTML=`<p class="p-5 text-center text-sm text-red-600">${esc(error.message)} <button onclick="location.reload()" class="underline">Retry</button></p>`;}
});
