(() => {
  const prefKey = () => document.body.classList.contains('admin-page')
    ? 'navigatorate.admin.preferences'
    : 'navigatorate.visitor.preferences';
  let activeUtterance = null;

  function preferences() {
    try {
      const value = JSON.parse(localStorage.getItem(prefKey()) || '{}');
      return value && typeof value === 'object' ? value : {};
    } catch {
      return {};
    }
  }

  function voices() {
    return 'speechSynthesis' in window ? window.speechSynthesis.getVoices() : [];
  }

  function stop() {
    if (!('speechSynthesis' in window)) return false;
    window.speechSynthesis.cancel();
    activeUtterance = null;
    return true;
  }

  function speak(text, { automatic = false, status = null } = {}) {
    if (automatic && !preferences().autoReadDescriptions) return 'disabled';
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
      if (status) status.textContent = 'Text-to-speech is not supported in this browser. The description is available as text.';
      return 'unsupported';
    }
    const content = String(text || '').trim();
    if (!content) {
      if (status) status.textContent = 'There is no description to read aloud.';
      return 'empty';
    }
    stop();
    const prefs = preferences();
    const utterance = new SpeechSynthesisUtterance(content);
    utterance.rate = Math.min(2, Math.max(0.5, Number(prefs.speechRate) || 1));
    const available = voices();
    const selected = available.find(voice => voice.voiceURI === prefs.speechVoice);
    const language = String(prefs.speechLanguage || 'en-US');
    utterance.voice = selected || available.find(voice => voice.lang.toLowerCase() === language.toLowerCase())
      || available.find(voice => voice.lang.toLowerCase().startsWith(language.slice(0, 2).toLowerCase()))
      || null;
    utterance.lang = utterance.voice?.lang || language;
    utterance.onstart = () => { if (status) status.textContent = 'Reading description aloud.'; };
    utterance.onend = () => {
      if (activeUtterance === utterance) activeUtterance = null;
      if (status) status.textContent = 'Finished reading description.';
    };
    utterance.onerror = event => {
      if (activeUtterance === utterance) activeUtterance = null;
      if (status) status.textContent = event.error === 'not-allowed'
        ? 'Automatic playback was blocked. Use Play to start reading.'
        : 'Speech playback is unavailable. The description is available as text.';
    };
    activeUtterance = utterance;
    window.speechSynthesis.speak(utterance);
    return 'started';
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-speech-action]');
    if (!button) return;
    const panel = button.closest('[data-speech-panel]') || button.parentElement;
    const status = panel?.querySelector('[data-speech-status]') || null;
    const action = button.dataset.speechAction;
    if (action === 'play') speak(button.dataset.speechText || '', { status });
    else if (action === 'pause' && 'speechSynthesis' in window) {
      window.speechSynthesis.pause();
      if (status) status.textContent = 'Speech paused.';
    } else if (action === 'resume' && 'speechSynthesis' in window) {
      window.speechSynthesis.resume();
      if (status) status.textContent = 'Speech resumed.';
    } else if (action === 'stop') {
      stop();
      if (status) status.textContent = 'Speech stopped.';
    }
  });

  window.addEventListener('pagehide', stop);
  window.CampusAccessibility = { speak, stop, voices, preferences };
})();
