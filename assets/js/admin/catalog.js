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
  const arrangeAddForm=(form,kind)=>{
    if(!form||form.dataset.editLayoutApplied)return;
    form.dataset.editLayoutApplied='true';
    const wrapperFor=name=>name==='photo'&&form.querySelector('.catalog-add-photo-panel')
      ?form.querySelector('.catalog-add-photo-panel')
      :name==='model_3d_file'
      ?form.querySelector('.catalog-model-panel')
      :name==='accessibility_features'
      ?form.querySelector('.catalog-checklist-dropdown')||form.querySelector('fieldset:has([name="accessibility_features"])')
      :name==='category_ids'
        ?form.querySelector('[data-category-dropdown]')
        :form.querySelector(`[name="${name}"]`)?.closest('label,[data-add-section]')||null;
    const take=name=>wrapperFor(name);
    const ordered=kind==='room'
      ? ['name','room','buildingId','category_ids','floor','capacity','description','accessibility_features','contact_email','contact_phone','service_hours','days_open','lunch_break','accessibility_status']
      : ['name','category_ids',...(kind==='building'?['floors']:[]),'capacity','description','accessibility_features','contact_email','contact_phone','service_hours','days_open','lunch_break','accessibility_status'];
    const nodes=[],used=new Set();
    for(const name of ordered){const node=take(name);if(node&&!used.has(node)){nodes.push(node);used.add(node);}}
    const photo=take('photo');
    if(photo){photo.classList.add('admin-edit-wide');nodes.push(photo);used.add(photo);}
    if(kind!=='room'){
      const model=take('model_3d_file');
      if(model){model.classList.add('admin-edit-wide');nodes.push(model);used.add(model);}
    }
    const statusRow=form.querySelector('[id$="-form-status"]')?.parentElement;
    for(const node of [...form.children])if(!used.has(node)&&node!==statusRow){
      if(node.matches('label,fieldset,[data-add-section]')&&node.querySelector('[name="accessibility_details"]')){node.remove();continue;}
      if(node.querySelector('[name="accessibility_features"]')){node.classList.add('admin-edit-wide');nodes.splice(Math.max(0,nodes.findIndex(item=>item.querySelector('[name="contact_email"]'))),0,node);used.add(node);}
    }
    form.replaceChildren(...nodes,...(statusRow?[statusRow]:[]));
    const setFieldLabel=(name,label)=>{
      const wrapper=take(name);if(!wrapper)return;
      const textNode=[...wrapper.childNodes].find(node=>node.nodeType===Node.TEXT_NODE&&node.textContent.trim());
      if(textNode)textNode.textContent=' '+label+' ';
      else{const heading=wrapper.querySelector('.admin-field-label');if(heading)heading.textContent=label;}
    };
    setFieldLabel('name',kind==='room'?'Room name':'Name');
    setFieldLabel('room','Room number');
    setFieldLabel('buildingId','Building');
    setFieldLabel('floor','Floor level');
    setFieldLabel('description','Description');
    setFieldLabel('capacity',kind==='room'?'Maximum capacity':'Capacity');
    setFieldLabel('floors','Number of floors');
    setFieldLabel('photo',kind==='building'?'Building photo':'Facility photo');
    setFieldLabel('model_3d_file','3D Model (.glb)');
    form.classList.add('admin-edit-fields','catalog-add-fields');
    form.querySelectorAll('input,select,textarea').forEach(control=>{if(control.type!=='checkbox'&&control.type!=='file')control.classList.add('admin-edit-control');});
  };
  const statusNode=()=>document.querySelector('#building-form-status,#facility-form-status,#classroom-form-status,#category-status');
  const status=message=>{const node=statusNode();if(node)node.textContent=message;};
  const notify=(message,tone='success')=>window.AdminUI?.toast(message,tone);
  const upload=async(input,type='photo',onProgress)=>{
    let file=input?.files?.[0];if(!file)return null;
    if(type==='model'&&file.size>50*1024*1024)throw new Error('The 3D model must be 50 MB or smaller.');
    if(type==='photo'){
      if(!/^image\/(?:png|jpeg|webp)$/i.test(file.type))throw new Error('Choose a PNG, JPG, or WebP photo.');
      if(file.size>15*1024*1024)throw new Error('Choose a photo smaller than 15 MB.');
      try{
        const bitmap=await createImageBitmap(file),scale=Math.min(1,1280/Math.max(bitmap.width,bitmap.height));
        const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
        const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
        const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.78));
        if(!blob)throw new Error('The selected photo could not be compressed.');
        file=new File([blob],(file.name.replace(/\.[^.]+$/,'')||'campus-photo')+'.jpg',{type:'image/jpeg',lastModified:Date.now()});
      }catch(error){if(error instanceof Error&&/compressed|opened/.test(error.message))throw error;throw new Error('The selected photo could not be prepared. Try another JPG, PNG, or WebP image.');}
    }
    const data=new FormData();data.append('file',file);data.append('type',type);
    return(await CampusApi.request('uploads',{method:'POST',body:data,onUploadProgress:onProgress})).path;
  };
  const optionalText=(form,name)=>form.elements[name]?.value.trim()||null;
  const supportedAccessibilityFeatures=new Set(['wheelchair_accessibility','elevator','accessible_restroom','accessible_parking','handrails','braille_signage']);
  const selectedAccessibilityFeatures=form=>[...form.querySelectorAll('[name="accessibility_features"]:checked')].map(control=>control.value).filter(value=>supportedAccessibilityFeatures.has(value));
  const detailPayload=form=>({
    contact_email:optionalText(form,'contact_email'),
    contact_phone:optionalText(form,'contact_phone'),
    service_hours:optionalText(form,'service_hours'),
    days_open:optionalText(form,'days_open'),
    lunch_break:optionalText(form,'lunch_break'),
    accessibility_status:form.elements.accessibility_status?.value===''||!form.elements.accessibility_status?null:Number(form.elements.accessibility_status.value),
    accessibility_details:selectedAccessibilityFeatures(form).map(feature=>feature.replaceAll('_',' ')).join('\n')||null
  });
  const catOptions=(selected=[])=>{const ids=(Array.isArray(selected)?selected:[selected]).map(String);return categories.map(item=>`<option value="${esc(item.id)}" ${ids.includes(String(item.id))?'selected':''}>${esc(item.name)}</option>`).join('');};
  const selectedCategoryIds=form=>[...(form.querySelector('[name="category_ids"]')?.selectedOptions||[])].map(option=>Number(option.value)).filter(Number.isFinite);
  const enhanceCategoryDropdown=select=>{
    if(!select||select.dataset.dropdownEnhanced)return;
    select.dataset.dropdownEnhanced='true';
    select.removeAttribute('required');
    const details=document.createElement('details');
    details.className='catalog-checklist-dropdown admin-edit-wide';
    details.dataset.categoryDropdown='';
    const summary=document.createElement('summary');
    summary.className='catalog-checklist-summary';
    summary.innerHTML='<span class="catalog-checklist-title">Categories</span><span class="catalog-checklist-count" data-category-selection>Select categories</span>';
    const list=document.createElement('div');
    list.className='catalog-category-checklist-options catalog-checklist-options';
    [...select.options].forEach(option=>{
      const label=document.createElement('label');
      label.className='catalog-category-checklist-option catalog-checklist-option';
      const checkbox=document.createElement('input');
      checkbox.type='checkbox';
      checkbox.value=option.value;
      checkbox.checked=option.selected;
      checkbox.className='catalog-category-checkbox';
      checkbox.addEventListener('change',()=>{
        option.selected=checkbox.checked;
        updateLabel();
        select.dispatchEvent(new Event('change',{bubbles:true}));
      });
      const text=document.createElement('span');
      text.textContent=option.textContent;
      label.append(checkbox,text);
      list.append(label);
    });
    const updateLabel=()=>{
      const checked=[...list.querySelectorAll('input[type="checkbox"]:checked')];
      const names=checked.map(input=>select.querySelector('option[value="'+CSS.escape(input.value)+'"]')?.textContent).filter(Boolean);
      const label=summary.querySelector('[data-category-selection]');
      label.textContent=checked.length?checked.length+' selected':'Select categories';
      summary.setAttribute('aria-label',checked.length?'Categories: '+names.join(', '):'Select categories');
    };
    // Move the original label before placing the select inside the new
    // details element. Otherwise select.after(details) tries to insert an
    // ancestor after its own descendant and throws a HierarchyRequestError.
    const originalLabel=select.closest('label');
    if(originalLabel)originalLabel.replaceWith(details);
    else select.before(details);
    details.append(summary,list,select);
    select.hidden=true;
    select.form?.addEventListener('reset',()=>setTimeout(()=>{
      list.querySelectorAll('input[type="checkbox"]').forEach((checkbox,index)=>{
        checkbox.checked=!!select.options[index]?.selected;
      });
      updateLabel();
    },0));
    updateLabel();
  };
  const enhanceAccessibilityDropdown=fieldset=>{
    if(!fieldset||fieldset.dataset.dropdownEnhanced)return;
    fieldset.dataset.dropdownEnhanced='true';
    const selected=new Set([...fieldset.querySelectorAll('input[name="accessibility_features"]:checked')].map(input=>input.value));
    const aliases={
      wheelchair_accessibility:['wheelchair_accessibility','wheelchair_entrance','wheelchair_accessible_entrance','ramp','wheelchair_accessible_ramp','accessible_pathways','wheelchair_accessible_pathways'],
      elevator:['elevator'],
      accessible_restroom:['accessible_restroom'],
      accessible_parking:['accessible_parking'],
      handrails:['handrails'],
      braille_signage:['braille_signage']
    };
    const options=[
      ['wheelchair_accessibility','Wheelchair accessibility'],
      ['elevator','Elevator'],
      ['accessible_restroom','Accessible restroom'],
      ['accessible_parking','Accessible parking'],
      ['handrails','Handrails'],
      ['braille_signage','Braille signage']
    ];
    const details=document.createElement('details');details.className='catalog-checklist-dropdown admin-edit-wide';
    const summary=document.createElement('summary');summary.className='catalog-checklist-summary';
    summary.innerHTML='<span class="catalog-checklist-title">Accessibility features</span><span data-accessibility-selection class="catalog-checklist-count">Select features</span>';
    const content=document.createElement('div');content.className='catalog-category-checklist-options catalog-checklist-options';
    options.forEach(([value,labelText])=>{
      const label=document.createElement('label');label.className='catalog-category-checklist-option catalog-checklist-option';
      const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.name='accessibility_features';checkbox.value=value;checkbox.className='catalog-category-checkbox';
      checkbox.checked=(aliases[value]||[value]).some(alias=>selected.has(alias));
      const labelTextNode=document.createElement('span');labelTextNode.textContent=labelText;
      label.append(checkbox,labelTextNode);content.append(label);
    });
    const updateLabel=()=>{
      const checked=[...details.querySelectorAll('[name="accessibility_features"]:checked')];
      summary.querySelector('[data-accessibility-selection]').textContent=checked.length?checked.length+' selected':'Select features';
      summary.setAttribute('aria-label',checked.length?'Accessibility features: '+checked.map(input=>input.closest('label')?.textContent.trim()).filter(Boolean).join(', '):'Select accessibility features');
    };
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
    form.addEventListener('input',event=>{if(!event.target.matches('[data-model-file]'))form.dataset.dirty='true';});form.addEventListener('change',event=>{if(!event.target.matches('[data-model-file]'))form.dataset.dirty='true';});
        dialog.querySelectorAll('[data-editor-close]').forEach(button=>button.addEventListener('click',requestClose));
    dialog.addEventListener('cancel',event=>{event.preventDefault();requestClose();});
    dialog.addEventListener('click',event=>{if(event.target===dialog)requestClose();});
    dialog.addEventListener('click',manageGalleryAction);
    dialog.querySelector('form').addEventListener('submit',saveEditor);
  };
  const field=(label,name,value,type='text',required=false,extra='')=>`<label><span class="admin-field-label">${label}${required?' <span class="text-red-600" aria-label="required">*</span>':''}</span><input name="${name}" type="${type}" value="${esc(value)}" ${required?'required':''} ${extra}></label>`;
  const selectField=(label,name,options,selected,required=true)=>`<label><span class="admin-field-label">${label}${required?' <span class="text-red-600" aria-label="required">*</span>':''}</span><select name="${name}" ${required?'required':''}>${options}</select></label>`;
  const multiSelectField=(label,name,options,selected=[])=>`<div class="admin-edit-wide grid gap-1"><span class="font-semibold text-slate-700">${label} <span class="text-red-600" aria-label="required">*</span></span><select name="${name}" multiple size="${Math.min(6,Math.max(3,categories.length))}" class="catalog-multi-category">${catOptions(selected)}</select><small class="block text-slate-500">Choose one or more categories from the dropdown.</small></div>`;
  const areaField=(label,name,value,max=1000)=>`<label class="admin-edit-wide">${label}<textarea name="${name}" rows="2" maxlength="${max}">${esc(value||'')}</textarea></label>`;
  const accessibilityFeatureOptions=[
    ['wheelchair_accessibility','Wheelchair accessibility'],
    ['elevator','Elevator'],
    ['accessible_restroom','Accessible restroom'],
    ['accessible_parking','Accessible parking'],
    ['handrails','Handrails'],
    ['braille_signage','Braille signage']
  ];
  const accessibilityFeatureFields=selected=>{
    const values=new Set((Array.isArray(selected)?selected:[]).map(value=>String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'')));
    const wheelchairSelected=['wheelchair_accessibility','wheelchair_entrance','wheelchair_accessible_entrance','ramp','wheelchair_accessible_ramp','accessible_pathways','wheelchair_accessible_pathways'].some(value=>values.has(value));
    return `<fieldset class="admin-edit-wide rounded-xl border border-blue-100 bg-blue-50/60 p-4"><legend class="px-1 font-bold">Accessibility features</legend><p class="mb-3 text-xs text-slate-500">Select the accessibility features confirmed for this location.</p><div class="grid gap-2 sm:grid-cols-2">${accessibilityFeatureOptions.map(([value,label])=>`<label class="flex items-center gap-2 text-xs"><input type="checkbox" name="accessibility_features" value="${value}" ${(value==='wheelchair_accessibility'?wheelchairSelected:values.has(value))?'checked':''}>${label}</label>`).join('')}</div></fieldset>`;
  };
  const serviceHoursField=value=>{
    const raw=String(value||'').trim();
    const range=raw.match(/(\d{1,2}:\d{2})\s*(AM|PM)\s*[–—-]\s*(\d{1,2}:\d{2})\s*(AM|PM)/i);
    const to24=(time,ampm)=>{if(!time)return '';let [hour,minute]=time.split(':').map(Number);if(ampm.toUpperCase()==='PM'&&hour!==12)hour+=12;if(ampm.toUpperCase()==='AM'&&hour===12)hour=0;return String(hour).padStart(2,'0')+':'+String(minute).padStart(2,'0');};
    const open=range?to24(range[1],range[2]):'',close=range?to24(range[3],range[4]):'';
    const mode=range?'custom':['24 hours','By appointment','Varies','Closed'].includes(raw)?raw:'custom';
    const options=[['custom','Set opening and closing time'],['24 hours','24 Hours'],['By appointment','By Appointment'],['Varies','Varies'],['Closed','Closed']];
    return `<div class="admin-edit-wide catalog-service-hours" data-add-section data-service-hours-control>
      <span class="admin-field-label">Service hours</span>
      <select data-service-mode class="admin-edit-control" aria-label="Service hours schedule type">${options.map(([v,label])=>`<option value="${esc(v)}" ${mode===v?'selected':''}>${label}</option>`).join('')}</select>
      <div class="catalog-service-time-fields" data-service-time-fields ${mode==='custom'?'':'hidden'}>
        <label><span class="admin-field-label">Opening time</span><input type="time" data-service-open value="${open}" class="admin-edit-control"></label>
        <label><span class="admin-field-label">Closing time</span><input type="time" data-service-close value="${close}" class="admin-edit-control"></label>
      </div>
      <small data-service-hours-hint>${mode==='custom'?(raw&&!range?'Current saved value: '+esc(raw)+' — select both times to update.':'Choose the opening and closing times.'):'The selected schedule will be saved as the service hours.'}</small>
      <input type="hidden" name="service_hours" value="${esc(raw)}">
    </div>`;
  };
  const syncServiceHours=control=>{
    const mode=control.querySelector('[data-service-mode]')?.value||'custom';
    const open=control.querySelector('[data-service-open]')?.value||'';
    const close=control.querySelector('[data-service-close]')?.value||'';
    const fields=control.querySelector('[data-service-time-fields]');
    const hidden=control.querySelector('[name="service_hours"]');
    const hint=control.querySelector('[data-service-hours-hint]');
    if(fields){
      const showTimes=mode==='custom';
      fields.hidden=!showTimes;
      fields.style.display=showTimes?'grid':'none';
      fields.setAttribute('aria-hidden',String(!showTimes));
    }
    if(hidden)hidden.value=mode==='custom'?(open&&close?`${formatServiceTime(open)} – ${formatServiceTime(close)}`:'') : mode;
    if(hint)hint.textContent=mode==='custom'?'Choose the opening and closing times.':'The selected schedule will be saved as the service hours.';
  };
  const formatServiceTime=value=>{
    if(!value)return '';
    const [hourText,minute]=value.split(':');let hour=Number(hourText);const suffix=hour>=12?'PM':'AM';hour=hour%12||12;
    return `${hour}:${minute} ${suffix}`;
  };
  const enhanceServiceHoursFields=root=>{
    root.querySelectorAll('select[name="service_hours"]').forEach(select=>{
      const wrapper=select.closest('label');
      if(wrapper)wrapper.outerHTML=serviceHoursField(select.value);
    });
    root.querySelectorAll('[data-service-hours-control]').forEach(syncServiceHours);
  };
  document.addEventListener('input',event=>{const control=event.target.closest?.('[data-service-hours-control]');if(control)syncServiceHours(control);});
  document.addEventListener('change',event=>{const control=event.target.closest?.('[data-service-hours-control]');if(control)syncServiceHours(control);});
  const ensureAddModelField=form=>{
    if(!form||form===roomForm||form.querySelector('[name="model_3d_file"]'))return;
    const section=document.createElement('section');
    section.className='admin-edit-wide catalog-model-panel';
    section.dataset.addSection='';
    section.innerHTML=`<div class="catalog-section-heading"><div><h3>3D Model</h3><p>Optionally upload a GLB model and preview it before adding this campus location.</p></div><span class="catalog-count">Optional</span></div>
      <div class="catalog-model-upload"><label class="catalog-model-file-label">3D model file<input name="model_3d_file" type="file" accept=".glb,model/gltf-binary,application/octet-stream"></label><button type="button" class="admin-button-primary" data-add-model-choose>Upload 3D Model</button></div>
      <p data-add-model-name class="text-xs text-slate-500 mt-2">No 3D model selected.</p>
      <model-viewer data-add-model-preview class="w-full mt-3 rounded-xl" style="height:260px;background:#eef3f8;display:none" camera-controls auto-rotate shadow-intensity="1" exposure="1" environment-image="neutral" alt="3D preview of the selected campus model"></model-viewer>
      <button type="button" data-add-model-clear class="admin-button-secondary mt-2" hidden>Remove selected model</button>`;
    form.append(section);
    if(!document.querySelector('script[data-model-viewer-loader]')){
      const script=document.createElement('script');
      script.type='module';
      script.src='https://ajax.googleapis.com/ajax/libs/model-viewer/4.0.0/model-viewer.min.js';
      script.dataset.modelViewerLoader='';
      document.head.append(script);
    }
    const input=section.querySelector('[name="model_3d_file"]');
    section.querySelector('[data-add-model-choose]')?.addEventListener('click',()=>input.click());
    const viewer=section.querySelector('[data-add-model-preview]');
    const name=section.querySelector('[data-add-model-name]');
    const clear=section.querySelector('[data-add-model-clear]');
    let previewUrl=null;
    const clearPreview=()=>{
      if(previewUrl)URL.revokeObjectURL(previewUrl);
      previewUrl=null;
      viewer.removeAttribute('src');
      viewer.style.display='none';
      name.textContent='No 3D model selected.';
      clear.hidden=true;
      input.value='';
    };
    input.addEventListener('change',()=>{
      const file=input.files?.[0];
      if(previewUrl)URL.revokeObjectURL(previewUrl);
      previewUrl=null;
      if(!file){clearPreview();return;}
      if(!/\.glb$/i.test(file.name)||file.size>50*1024*1024){
        window.AdminUI?.toast(file.size>50*1024*1024?'The 3D model must be 50 MB or smaller.':'Choose a .glb 3D model file.','error');
        clearPreview();
        return;
      }
      previewUrl=URL.createObjectURL(file);
      viewer.src=previewUrl;
      viewer.style.display='block';
      name.textContent=file.name;
      clear.hidden=false;
    });
    clear.addEventListener('click',clearPreview);
    form.addEventListener('reset',()=>setTimeout(clearPreview,0));
  };
  const dayOptions=['Select days open','Monday – Friday','Monday – Saturday','Monday – Sunday','Weekdays only','Weekends only','By appointment','Closed'];
  const lunchOptions=['Select lunch hours','12:00 PM – 1:00 PM','12:00 PM – 12:30 PM','12:00 PM – 1:30 PM','No lunch break','Varies'];
  const floorOptions=['Ground Level','2nd Floor','3rd Floor','4th Floor','5th Floor','6th Floor','7th Floor','8th Floor','9th Floor','10th Floor','Basement'];
  const presetField=(label,name,options,value)=>selectField(label,name,options.map((option,index)=>`<option value="${index===0?'':esc(option)}" ${value===option?'selected':''}>${esc(option)}</option>`).join('')+(value&&!options.includes(value)?`<option selected value="${esc(value)}">${esc(value)}</option>`:''),value||'',false);
  const accessibilityStatusField=item=>{
    const raw=item.accessibility_status??item.accessibilityStatus;
    const normalized=typeof raw==='string'?raw.trim().toLowerCase():raw;
    const selected=raw===null||raw===undefined||raw===''?'':([true,1,'1','true','t','yes'].includes(normalized)?'1':([false,0,'0','false','f','no'].includes(normalized)?'0':''));
    return selectField('Accessibility information','accessibility_status',`<option value="" ${selected===''?'selected':''}>Not recorded</option><option value="1" ${selected==='1'?'selected':''}>Accessible</option><option value="0" ${selected==='0'?'selected':''}>Not accessible</option>`,selected,false);
  };
  const extraLocationFields=item=>field('Contact email','contact_email',item.contact_email||'','email',false,'maxlength="254"')+
    field('Contact phone','contact_phone',item.contact_phone||'','tel',false,'maxlength="40"')+
    serviceHoursField(item.service_hours)+
    presetField('Days open','days_open',dayOptions,item.days_open)+
    presetField('Lunch hours','lunch_break',lunchOptions,item.lunch_break)+
    accessibilityStatusField(item);
  const extraRoomFields=item=>field('Contact email','contact_email',item.contact_email||'','email',false,'maxlength="254"')+
    field('Contact phone','contact_phone',item.contact_phone||'','tel',false,'maxlength="40"')+
    serviceHoursField(item.service_hours)+
    presetField('Days open','days_open',dayOptions,item.days_open)+
    presetField('Lunch hours','lunch_break',lunchOptions,item.lunch_break)+
    accessibilityStatusField(item);
  function galleryPhotoCard(photo,itemId,isDefault=false){
    return `<article class="catalog-gallery-item" data-photo-id="${esc(photo.id)}" data-photo-is-cover="${(Number(photo.isCover)||isDefault)?'true':'false'}"><img src="${esc(imageSrc(photo.image))}" alt="${esc(photo.caption||'Campus photo')}" loading="lazy"><div class="catalog-gallery-card-actions"><button type="button" data-photo-details class="admin-button-secondary">Photo details</button><button type="button" data-photo-delete class="admin-button-secondary">Remove</button></div><div class="catalog-photo-details" data-photo-details-panel hidden><div class="catalog-photo-details-heading"><strong>Edit Photo Details</strong><button type="button" data-photo-details-close aria-label="Close photo details">Close</button></div><label class="catalog-photo-caption-field"><span>Caption</span><input data-photo-caption maxlength="255" value="${esc(photo.caption||'')}" placeholder="Describe this photo"></label><div class="catalog-gallery-actions"><button type="button" data-photo-save class="admin-button-primary">Save details</button></div></div></article>`;
  }
  function galleryMarkup(type,item){
    const ownerType=type==='location'?'location':'room';
    const photos=[...new Map((item.photos||[]).filter(photo=>photo?.image).map(photo=>[imageSrc(photo.image),photo])).values()];
    const coverIndex=photos.findIndex(photo=>Number(photo.isCover)===1||photo.isCover===true);
    return `<section class="admin-edit-wide catalog-gallery-panel" data-gallery-owner="${ownerType}" data-gallery-id="${esc(item.id)}">
      <div class="catalog-section-heading"><div><h3>Photo Gallery</h3><p>Upload and manage photos for this location.</p></div><span class="catalog-count">${photos.length} ${photos.length===1?'photo':'photos'}</span></div>
      <div class="catalog-gallery-grid">${photos.length?photos.map((photo,index)=>galleryPhotoCard(photo,item.id,index===coverIndex)).join(''):'<p class="catalog-gallery-empty">No photos have been added yet.</p>'}</div>
      <div class="catalog-gallery-upload"><div><strong>Add photos</strong><p>Select one image and optionally add a caption.</p></div><label>Choose photo<input type="file" data-gallery-file accept="image/png,image/jpeg,image/webp"></label><label>Caption (optional)<input data-gallery-caption maxlength="255" placeholder="Describe this photo"></label><div class="catalog-photo-progress" data-photo-progress hidden><div><span data-photo-progress-label>Uploading photo</span><strong data-photo-progress-value>0%</strong></div><progress max="100" value="0" data-photo-progress-bar></progress></div><button type="button" data-photo-add class="admin-button-primary">Upload photo</button></div>
    </section>`;
  }
  function modelMarkup(item){
    const hasModel=Boolean(item.model_3d_url);
    return `<section class="admin-edit-wide catalog-model-panel" data-model-owner="location" data-model-id="${esc(item.id)}"><div class="catalog-section-heading"><div><h3>3D Model</h3><p>Upload a 3D model to let visitors explore this building or facility.</p></div><span class="catalog-count">${hasModel?'Model uploaded':'No model'}</span></div><div class="catalog-model-content">${hasModel?`<div class="catalog-model-status"><span class="material-symbols-rounded" aria-hidden="true">view_in_ar</span><div><strong>3D model available</strong><p>Upload a new GLB file below to replace the current model.</p><a href="${esc(item.model_3d_url)}" target="_blank" rel="noopener noreferrer">Open current 3D model</a></div></div>`:'<div class="catalog-model-status"><span class="material-symbols-rounded" aria-hidden="true">view_in_ar</span><div><strong>No 3D model uploaded</strong><p>This is optional. You can add a GLB model at any time.</p></div></div>'}<div class="catalog-model-upload"><label>Choose 3D model (.glb)<input data-model-file type="file" accept=".glb,model/gltf-binary,application/octet-stream"></label><button type="button" data-model-upload class="admin-button-primary">Upload 3D Model</button><small>Maximum file size: 50 MB. A new upload replaces the current model.</small></div></div></section>`;
  }
  async function manageGalleryAction(event){
    const button=event.target.closest('[data-model-upload],[data-photo-add],[data-photo-save],[data-photo-delete],[data-photo-details],[data-photo-details-close]');if(!button)return;
    const modelSection=button.closest('[data-model-owner]');
    if(button.hasAttribute('data-model-upload')){
      const fileInput=modelSection?.querySelector('[data-model-file]'),status=document.getElementById('catalog-editor-status');
      if(!fileInput?.files?.length){status.textContent='Choose a GLB model to upload.';return;}
      button.disabled=true;button.textContent='Uploading…';
      try{
        const modelPath=await upload(fileInput,'model');
        await CampusApi.request('locations',{method:'PATCH',body:{id:Number(modelSection.dataset.modelId),model_3d_path:modelPath}});
        await refresh();
        const savedItem=locations.find(row=>String(row.id)===modelSection.dataset.modelId);
        if(!savedItem)throw new Error('The model was uploaded, but the updated record could not be reloaded.');
        pendingEdit.item=savedItem;
        modelSection.outerHTML=modelMarkup(savedItem);
        status.textContent='3D model uploaded successfully.';notify('3D model uploaded successfully.');
      }catch(error){status.textContent=error.message;notify(error.message,'error');button.disabled=false;button.textContent='Upload 3D Model';}
      return;
    }

    const section=button.closest('[data-gallery-owner]'),card=button.closest('[data-photo-id]'),status=document.getElementById('catalog-editor-status');
    if(!section)return;
    if(button.hasAttribute('data-photo-details')){const panel=card.querySelector('[data-photo-details-panel]');panel.hidden=!panel.hidden;button.textContent=panel.hidden?'Photo details':'Hide details';return;}
    if(button.hasAttribute('data-photo-details-close')){card.querySelector('[data-photo-details-panel]').hidden=true;card.querySelector('[data-photo-details]').textContent='Photo details';return;}
    button.disabled=true;
    try{
      if(button.hasAttribute('data-photo-add')){
        const fileInput=section.querySelector('[data-gallery-file]'),captionInput=section.querySelector('[data-gallery-caption]');
        const progress=section.querySelector('[data-photo-progress]'),bar=section.querySelector('[data-photo-progress-bar]'),value=section.querySelector('[data-photo-progress-value]'),label=section.querySelector('[data-photo-progress-label]');
        if(!fileInput?.files?.length){status.textContent='Choose a photo to upload.';return;}
        const setProgress=percent=>{if(progress)progress.hidden=false;if(bar)bar.value=percent;if(value)value.textContent=percent+'%';if(label)label.textContent=percent>=100?'Saving photo details…':'Uploading photo';};
        button.textContent='Uploading…';status.textContent='Preparing your photo…';setProgress(0);
        const image_path=await upload(fileInput,'photo',setProgress);
        await CampusApi.request('facility-photos',{method:'POST',body:{owner_type:section.dataset.galleryOwner,owner_id:Number(section.dataset.galleryId),image_path,alt_text:captionInput.value.trim()||'Campus photo',caption:captionInput.value.trim()||null}});
        status.textContent='Photo added to the gallery.';notify('Photo uploaded successfully.');
      }else if(button.hasAttribute('data-photo-save')){
        const caption=card.querySelector('[data-photo-caption]').value.trim()||null;
        const cards=[...section.querySelectorAll('[data-photo-id]')];
        await Promise.all(cards.map(photoCard=>{
          const photoCaption=photoCard.querySelector('[data-photo-caption]').value.trim()||null;
          return CampusApi.request('facility-photos',{method:'PUT',body:{id:Number(photoCard.dataset.photoId),caption:photoCaption,is_cover:photoCard.dataset.photoIsCover==='true',sort_order:0}});
        }));
        status.textContent='Photo caption saved successfully.';
      }else{
        if(!await window.AdminUI.confirm({title:'Remove gallery photo?',message:'This removes the photo from the saved campus gallery. The building or room record will remain.',confirmLabel:'Remove photo',danger:true}))return;
        await CampusApi.remove('facility-photos',Number(card.dataset.photoId));status.textContent='Photo removed from the gallery.';
      }
      await refresh();const item=section.dataset.galleryOwner==='location'?locations.find(row=>String(row.id)===section.dataset.galleryId):rooms.find(row=>String(row.id)===section.dataset.galleryId);
      if(item)section.outerHTML=galleryMarkup(section.dataset.galleryOwner==='location'?'location':'room',item);
    }catch(error){status.textContent=error.message;notify(error.message,'error');}finally{button.disabled=false;if(button.hasAttribute('data-photo-add'))button.textContent='Upload photo';}
  }
  function openEditor(type,item){
    ensureEditor();pendingEdit={type,item};
    const dialog=document.getElementById('catalog-editor'),fields=document.getElementById('catalog-editor-fields');
    const selectedCategoryIds=Array.isArray(item.category_ids)&&item.category_ids.length?item.category_ids:[item.category_id||categories.find(category=>category.name===item.category)?.id].filter(Boolean);
    if(type==='location'){
      document.getElementById('catalog-editor-title').textContent=item.kind==='building'?'Edit building':'Edit facility';
      fields.innerHTML=field('Name','name',item.name,'text',true,'maxlength="150"')+
        multiSelectField('Categories','category_ids',null,selectedCategoryIds)+
        (item.kind==='building'?field('Number of floors','floor_count',item.floor_count||1,'number',true,'min="1" max="100"'):'')+
        field('Capacity','capacity',item.capacity??'','number',false,'min="0"')+
        '<label class="admin-edit-wide">Description<textarea name="description" rows="4" maxlength="4000">'+esc(item.description||'')+'</textarea></label>'+
        accessibilityFeatureFields(item.accessibility_features||String(item.accessibility_details||'').split(/\r?\n/).map(value=>value.trim().replaceAll(' ','_')))+extraLocationFields(item)+galleryMarkup(type,item)+modelMarkup(item);
    }else if(type==='room'){
      document.getElementById('catalog-editor-title').textContent='Edit room or office';
      fields.innerHTML=field('Room name','name',item.name,'text',true,'maxlength="150"')+
        field('Room number','room_number',item.room_number,'text',true,'maxlength="50"')+
        selectField('Building','building_id','<option value="">Select a building</option>'+buildingOptions(item.building_id),item.building_id)+
        multiSelectField('Categories','category_ids',null,selectedCategoryIds)+
        presetField('Floor level','floor_label',floorOptions,item.floor_label||'')+
        field('Maximum capacity','capacity',item.capacity??'','number',false,'min="0"')+
        '<label class="admin-edit-wide">Description<textarea name="description" rows="3" maxlength="4000">'+esc(item.description||'')+'</textarea></label>'+ 
        accessibilityFeatureFields(String(item.accessibility_details||'').split(/\r?\n/).map(value=>value.trim().replaceAll(' ','_')))+extraRoomFields(item)+galleryMarkup(type,item);
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
    const preferred=['name','category','building_name','room_number','floor_label','floor_count','capacity','contact_email','contact_phone','service_hours','days_open','lunch_break','description','accessibility_status','accessibility_details','accessibility_features'];
    const labels={name:'Name',category:'Category',building_name:'Building',room_number:'Room number',floor_label:'Floor level',floor_count:'Floors',capacity:'Capacity',contact_email:'Email',contact_phone:'Phone',service_hours:'Service hours',days_open:'Days open',lunch_break:'Lunch hours',description:'Description',accessibility_status:'Accessibility',accessibility_details:'Accessibility features',accessibility_features:'Accessibility features'};
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
        const accessibilityFeatures=selectedAccessibilityFeatures(form);
        const uploadedModel=await upload(form.querySelector('[name="model_3d_file"]'),'model');
        await CampusApi.save('locations',{model_3d_path:uploadedModel||item.model_3d_object_path||item.model_3d_path||null,name:value('name'),kind:item.kind,category_ids:selectedCategoryIds(form),description:value('description')||null,building_number:item.building_number||null,floor_label:null,floor_count:isBuilding?Number(value('floor_count')||item.floor_count||1):1,parent_building_id:null,capacity:value('capacity')===''?null:Number(value('capacity')),image_path:item.image_object_path||item.image_path||null,department_name:item.department_name||null,contact_email:value('contact_email')||null,contact_phone:value('contact_phone')||null,website_url:item.website_url||null,service_hours:value('service_hours')||null,days_open:value('days_open')||null,lunch_break:value('lunch_break')||null,services:item.services||null,nearby_landmarks:item.nearby_landmarks||null,accessibility_status:value('accessibility_status')===''?null:Number(value('accessibility_status')),accessibility_details:accessibilityFeatures.map(feature=>feature.replaceAll('_',' ')).join('\n')||null,accessibility_features:isBuilding?accessibilityFeatures:[]},item.id);
      }else{
        const floorLabel=value('floor_label');
        await CampusApi.save('rooms',{name:value('name'),room_number:value('room_number'),route_node_id:item.route_node_id||null,building_id:Number(value('building_id')),category_ids:selectedCategoryIds(form),floor_label:floorLabel||null,floor_number:Number((floorLabel.match(/\d+/)||[])[0]||item.floor_number||0),capacity:value('capacity')===''?null:Number(value('capacity')),description:value('description')||null,function_description:item.function_description||null,department_head:item.department_head||null,image_path:item.image_path||null,department_name:item.department_name||null,contact_email:value('contact_email')||null,contact_phone:value('contact_phone')||null,website_url:item.website_url||null,service_hours:value('service_hours')||null,days_open:value('days_open')||null,lunch_break:value('lunch_break')||null,services:item.services||null,nearby_landmarks:item.nearby_landmarks||null,accessibility_status:value('accessibility_status')===''?null:Number(value('accessibility_status')),accessibility_details:selectedAccessibilityFeatures(form).map(feature=>feature.replaceAll('_',' ')).join('\n')||null},item.id);
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
    const parent=room?item.building_name:building?`${item.floor_count||1} floor${Number(item.floor_count)===1?'':'s'}`:locations.find(location=>String(location.id)===String(item.parent_building_id))?.name||'Building not assigned';
    const photo=item.photos?.find(entry=>Number(entry.isCover))||item.photos?.[0];
    const image=item.image||photo?.image||item.image_path;
    const kindLabel=room?'Room':building?'Building':'Facility';
    const detailHref=room?`../office.html?id=${encodeURIComponent(item.id)}`:`../building.html?id=${encodeURIComponent(item.id)}`;
    const mapHref=`../map.html?search=${encodeURIComponent(item.name)}`;
    const subtitle=room?`${parent||'Building unavailable'} · ${item.floor_label||'Floor unavailable'} · Room ${item.room_number||'—'}`:building?parent:`Located in ${parent}`;
    return `<article class="catalog-directory-card" data-id="${esc(item.id)}">
      <div class="catalog-directory-photo">${image?`<a href="${esc(imageSrc(image))}" target="_blank" rel="noopener noreferrer" aria-label="Open cover photo of ${esc(item.name)}"><img src="${esc(imageSrc(image))}" alt="" loading="lazy"></a>`:`<span class="material-symbols-rounded" aria-hidden="true">${room?'meeting_room':building?'location_city':'storefront'}</span>`}</div>
      <div class="catalog-directory-info"><div class="catalog-directory-meta"><span>${kindLabel}</span><span>${esc((item.category_names||[item.category]).filter(Boolean).join(' · ')||'Campus')}</span></div><h3>${esc(item.name)}</h3><p class="catalog-directory-description">${esc(item.description||'More information is available in this directory profile.')}</p><p class="catalog-directory-location">${esc(subtitle)}</p></div>
      <div class="catalog-directory-actions"><a href="${mapHref}"><span class="material-symbols-rounded" aria-hidden="true">map</span><span>Show on map</span></a><a href="${detailHref}"><span>Public page</span><span class="material-symbols-rounded" aria-hidden="true">arrow_forward</span></a><span class="catalog-row-action-group"><button data-action="details" class="admin-row-action">View details</button><button data-action="edit" class="admin-row-action">Edit</button><button data-action="archive" class="admin-row-action is-danger">Archive</button></span></div>
    </article>`;
  }).join('')}</div>`;
  function renderLocations(kind){
    const target=document.getElementById(kind==='building'?'buildings-list':'facilities-list');if(!target)return;if(locationLoadError){target.innerHTML=`<div class="p-5 text-center text-sm text-red-700"><strong>Could not load ${kind==='building'?'buildings':'facilities'}.</strong><p class="mt-1">${esc(locationLoadError.message||'The campus API request failed.')}</p><button type="button" class="mt-3 underline" onclick="location.reload()">Retry</button></div>`;return;}
    const term=searchTerms[kind].toLocaleLowerCase();const all=locations.filter(item=>isLocationKind(item,kind)&&item.active!==false);const filtered=all.filter(item=>`${item.name} ${item.category||''}`.toLocaleLowerCase().includes(term)&&(!categoryFilters[kind]||(item.category_names||[item.category]).includes(categoryFilters[kind]))).sort((a,b)=>sortOrders[kind]==='name-desc'?b.name.localeCompare(a.name):a.name.localeCompare(b.name));
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
      const preview=form.querySelector('[data-photo-preview]');
      if(form.elements.photo&&preview){
        const photoLabel=form.elements.photo.closest('label');
        if(photoLabel&&!photoLabel.closest('.catalog-add-photo-panel')){
          const photoPanel=document.createElement('section');
          photoPanel.className='admin-edit-wide catalog-gallery-panel catalog-add-photo-panel';
          const photoTitle=form===roomForm?'Room or Office Photo':form===facilityForm?'Facility Photo':'Building Photo';
          photoPanel.innerHTML=`<div class="catalog-section-heading"><div><h3>${photoTitle}</h3><p>Upload the main photo visitors will see in the campus directory.</p></div><span class="catalog-count">Optional</span></div><div class="catalog-gallery-upload catalog-add-photo-upload"></div>`;
          photoLabel.before(photoPanel);
          const photoCaption=document.createElement('label');photoCaption.className='catalog-add-photo-caption';photoCaption.innerHTML='Photo caption (optional)<input type="text" data-add-photo-caption maxlength="255" placeholder="Describe this photo">';
          const photoActions=document.createElement('div');photoActions.className='catalog-add-photo-actions';
          const photoButton=document.createElement('button');photoButton.type='button';photoButton.className='admin-button-primary';photoButton.textContent='Upload photo';photoButton.addEventListener('click',()=>form.elements.photo.click());
          photoActions.append(photoButton,photoLabel);
          photoPanel.querySelector('.catalog-add-photo-upload').append(photoActions,photoCaption);
          photoLabel.classList.add('catalog-add-photo-field');
          form.elements.photo.setAttribute('aria-label','Choose the main campus photo');
        }
        window.CampusPhotoTools?.bindPreview(form.elements.photo,preview);
        preview.classList.add('catalog-add-photo-preview');
        const progress=document.createElement('div');progress.className='catalog-photo-progress';progress.dataset.addPhotoProgress='';progress.hidden=true;
        progress.innerHTML='<div><span data-add-photo-label>Uploading photo</span><strong data-add-photo-value>0%</strong></div><progress max="100" value="0" data-add-photo-bar></progress>';
        preview.after(progress);
      }
      enhanceServiceHoursFields(form);
      ensureAddModelField(form);
      enhanceDropdownFields(form);
      const kind=form===buildingForm?'building':form===facilityForm?'facility':'room';
      arrangeAddForm(form,kind);
      const actionRow=form.querySelector('button[type="submit"]')?.parentElement;
      if(actionRow){actionRow.classList.add('admin-edit-actions','admin-edit-wide');}
      const submitButton=form.querySelector('button[type="submit"]');
      if(submitButton){submitButton.className='admin-button-primary';submitButton.textContent=`Add ${kind==='room'?'Room / Office':kind==='building'?'Building':'Facility'}`;}
      const formDialog=window.AdminUI?.mountFormDialog(form,{title:`Add ${kind}`,description:'Enter the campus information below. Required fields are marked in the form.',triggerLabel:`Add ${kind}`});
      if(formDialog?.dialog&&kind!=='room'){
        formDialog.dialog.classList.add('admin-edit-dialog','catalog-add-edit-dialog');
        formDialog.dialog.querySelector('.admin-create-dialog-heading')?.classList.add('admin-edit-dialog-heading');
        formDialog.dialog.querySelector('.admin-form-panel')?.classList.add('catalog-add-edit-panel');
      }
      form.addEventListener('submit',async event=>{event.preventDefault();if(!selectedCategoryIds(form).length){status('Select at least one category.');return;}const button=form.querySelector('[type="submit"]');button.disabled=true;status('Saving to the campus database…');
        try{
          const photoProgress=form.querySelector('[data-add-photo-progress]'),photoBar=photoProgress?.querySelector('[data-add-photo-bar]'),photoValue=photoProgress?.querySelector('[data-add-photo-value]'),photoLabel=photoProgress?.querySelector('[data-add-photo-label]');
          const setAddPhotoProgress=percent=>{if(photoProgress)photoProgress.hidden=false;if(photoBar)photoBar.value=percent;if(photoValue)photoValue.textContent=percent+'%';if(photoLabel)photoLabel.textContent=percent>=100?'Saving photo details…':'Uploading photo';};
          if(form.elements.photo?.files?.length&&photoProgress)photoProgress.hidden=false;
          const image_path=await upload(form.elements.photo,'photo',setAddPhotoProgress);let payload,resource;
          if(form===buildingForm){resource='locations';const model_3d_path=await upload(form.elements.model_3d_file,'model');payload={model_3d_path,name:form.elements.name.value.trim(),kind:'building',category_ids:selectedCategoryIds(form),description:optionalText(form,'description'),floor_count:Number(form.elements.floors.value),capacity:form.elements.capacity.value===''?null:Number(form.elements.capacity.value),image_path,...detailPayload(form),accessibility_features:selectedAccessibilityFeatures(form)};}
          else if(form===facilityForm){resource='locations';const model_3d_path=await upload(form.elements.model_3d_file,'model');payload={model_3d_path,name:form.elements.name.value.trim(),kind:'facility',category_ids:selectedCategoryIds(form),parent_building_id:null,floor_label:null,description:optionalText(form,'description'),floor_count:1,capacity:form.elements.capacity.value===''?null:Number(form.elements.capacity.value),image_path,...detailPayload(form)};}
          else{resource='rooms';payload={name:form.elements.name.value.trim(),building_id:Number(form.elements.buildingId.value),category_ids:selectedCategoryIds(form),room_number:form.elements.room.value.trim(),floor_label:form.elements.floor.value.trim(),floor_number:Number((form.elements.floor.value.match(/\d+/)||[])[0]||0),capacity:form.elements.capacity.value===''?null:Number(form.elements.capacity.value),department_head:optionalText(form,'head'),description:optionalText(form,'description'),function_description:optionalText(form,'function_description'),image_path,...detailPayload(form)};}
          const savedRecord=await CampusApi.save(resource,payload);
          const photoCaption=form.querySelector('[data-add-photo-caption]')?.value.trim()||'';
          if(image_path&&photoCaption){
            await refresh();
            const savedId=Number(savedRecord?.id||savedRecord?.location?.id||savedRecord?.room?.id||((resource==='rooms'?rooms:locations).filter(record=>record.name===form.elements.name.value.trim()&&(resource==='rooms'||isLocationKind(record,kind))).sort((a,b)=>Number(b.id)-Number(a.id))[0]?.id));
            if(savedId)await CampusApi.request('facility-photos',{method:'POST',body:{owner_type:resource==='rooms'?'room':'location',owner_id:savedId,image_path,alt_text:photoCaption,caption:photoCaption}});
          }
          await refresh();renderAll();form.reset();form.querySelectorAll('[data-photo-preview]').forEach(preview=>{preview.removeAttribute('src');preview.hidden=true;});if(form.elements.floors)form.elements.floors.value='1';if(form.elements.floor)form.elements.floor.value='Ground Level';if(form.elements.capacity)form.elements.capacity.value='0';formDialog?.close();if(photoProgress)photoProgress.hidden=true;status('Saved to the campus database.');notify(`${kind[0].toUpperCase()+kind.slice(1)} added successfully.`);
        }catch(error){status(error.message);notify(error.message,'error');}finally{button.disabled=false;}
      });
    }
    renderAll();
  }catch(error){status(error.message);const target=document.getElementById('buildings-list')||document.getElementById('facilities-list')||document.getElementById('classrooms-list');if(target)target.innerHTML=`<p class="p-5 text-center text-sm text-red-600">${esc(error.message)} <button onclick="location.reload()" class="underline">Retry</button></p>`;}
});
