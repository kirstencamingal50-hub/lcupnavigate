(() => {
  const key='navigatorate.visitor.preferences';
  const read=()=>{try{return JSON.parse(localStorage.getItem(key)||'{}')||{};}catch{return {};}};
  const voices=()=>window.CampusAccessibility?.voices()||[];
  function apply(prefs){const root=document.documentElement;root.dataset.theme=prefs.theme==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):(prefs.theme||'light');root.dataset.textSize=prefs.textSize||'normal';root.toggleAttribute('data-high-contrast',!!prefs.highContrast);root.toggleAttribute('data-reduce-motion',!!prefs.reduceMotion);}
  const prefs=read();apply(prefs);
  const save=(name,value)=>{
    try {
      const next={...read(),[name]:value};
      localStorage.setItem(key,JSON.stringify(next));
      apply(next);
      window.dispatchEvent(new CustomEvent('navigatorate:preferences-changed',{detail:next}));
      return true;
    } catch {
      const status=document.getElementById('visitor-settings-status');
      if(status)status.textContent='Preferences could not be saved in this browser.';
      return false;
    }
  };
  function fillVoices(){
    const select=document.querySelector('[data-visitor-pref="speechVoice"]');
    if(!select)return;
    const selected=read().speechVoice||'';
    const available=voices();
    select.innerHTML='<option value="">Default device voice</option>'+available.map(voice=>`<option value="${String(voice.voiceURI).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}">${String(voice.name+' · '+voice.lang).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}</option>`).join('');
    select.value=selected;
  }
  document.querySelectorAll('[data-visitor-pref]').forEach(control=>{
    const name=control.dataset.visitorPref;
    if(control.type==='checkbox')control.checked=!!prefs[name];
    else if(prefs[name]!==undefined&&[...control.options].some(option=>option.value===String(prefs[name])))control.value=String(prefs[name]);
    control.addEventListener('change',()=>{
      const value=control.type==='checkbox'?control.checked:control.type==='range'?Number(control.value):control.value;
      if(save(name,value)){
        const status=document.getElementById('visitor-settings-status');
        if(status)status.textContent='Preference saved on this device.';
      }
      if(name==='speechRate'){
        const output=document.getElementById('speech-rate-value');
        if(output)output.textContent=`${Number(value).toFixed(1)}×`;
      }
    });
  });
  const rateControl=document.querySelector('[data-visitor-pref="speechRate"]');
  const rateOutput=document.getElementById('speech-rate-value');
  if(rateControl&&rateOutput)rateOutput.textContent=`${Number(rateControl.value).toFixed(1)}×`;
  fillVoices();
  if('speechSynthesis' in window)window.speechSynthesis.addEventListener('voiceschanged',fillVoices);
  document.getElementById('clear-visitor-settings')?.addEventListener('click',()=>{
    if(!confirm('Clear the saved settings on this device?'))return;
    try{localStorage.removeItem(key);location.reload();}
    catch{const status=document.getElementById('visitor-settings-status');if(status)status.textContent='Saved preferences could not be cleared.';}
  });
})();
