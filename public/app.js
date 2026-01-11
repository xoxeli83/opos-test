// ===== Audio bar (index) =====
(function initAudioBar(){
  const audioBar = document.getElementById('audioBar');
  if (!audioBar) return; // si no estamos en index, salir

  const audioEl = document.getElementById('audioEl');
  const audioTitle = document.getElementById('audioTitle');
  const audioTime = document.getElementById('audioTime');
  const audioPlay = document.getElementById('audioPlay');
  const audioSeek = document.getElementById('audioSeek');
  const audioClose = document.getElementById('audioClose');

  const fmt = (s) => {
    if (!isFinite(s)) return '00:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  };

  function showBar(){
    audioBar.classList.remove('hidden');
  }
  function hideBar(){
    audioEl.pause();
    audioEl.removeAttribute('src');
    audioEl.load();
    audioBar.classList.add('hidden');
    audioPlay.textContent = '▶';
    audioSeek.value = 0;
    audioTime.textContent = '00:00 / 00:00';
  }

  audioPlay.addEventListener('click', () => {
    if (!audioEl.src) return;
    if (audioEl.paused) audioEl.play();
    else audioEl.pause();
  });

  audioClose.addEventListener('click', hideBar);

  audioEl.addEventListener('play', () => audioPlay.textContent = '⏸');
  audioEl.addEventListener('pause', () => audioPlay.textContent = '▶');

  audioEl.addEventListener('loadedmetadata', () => {
    audioSeek.max = String(audioEl.duration || 0);
    audioTime.textContent = `${fmt(0)} / ${fmt(audioEl.duration)}`;
  });

  audioEl.addEventListener('timeupdate', () => {
    if (!audioSeek.matches(':active')) {
      audioSeek.value = String(audioEl.currentTime || 0);
    }
    audioTime.textContent = `${fmt(audioEl.currentTime)} / ${fmt(audioEl.duration)}`;
  });

  audioSeek.addEventListener('input', () => {
    audioEl.currentTime = Number(audioSeek.value || 0);
  });

  // Click en cualquier link con data-audio
  document.querySelectorAll('[data-audio]').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const src = a.getAttribute('data-audio');
      const title = a.getAttribute('data-title') || 'Audio';

      audioTitle.textContent = title;
      audioEl.src = src;
      audioEl.load();
      showBar();
      audioEl.play().catch(()=>{ /* si el navegador bloquea autoplay, queda listo */ });
    });
  });
})();
