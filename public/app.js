// ===== Audio bar (index) =====
document.addEventListener('DOMContentLoaded', () => {
  const audioBar = document.getElementById('audioBar');
  if (!audioBar) return; // no estamos en index

  const audioEl = document.getElementById('audioEl');
  const audioTitle = document.getElementById('audioTitle');
  const audioMeta = document.getElementById('audioMeta');
  const audioTime = document.getElementById('audioTime');

  const audioPlay = document.getElementById('audioPlay');
  const audioPause = document.getElementById('audioPause');
  const audioStop = document.getElementById('audioStop');
  const audioSeek = document.getElementById('audioSeek');
  const audioClose = document.getElementById('audioClose');

  const fmt = (s) => {
    if (!isFinite(s)) return '00:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  };

  function showBar() {
    audioBar.classList.remove('hidden');
  }

  function hideBar() {
    audioEl.pause();
    audioEl.removeAttribute('src');
    audioEl.load();
    audioBar.classList.add('hidden');
    audioSeek.value = 0;
    audioTime.textContent = '00:00 / 00:00';
  }

  function stopAudio() {
    audioEl.pause();
    audioEl.currentTime = 0;
    audioSeek.value = 0;
    audioTime.textContent = `${fmt(0)} / ${fmt(audioEl.duration)}`;
  }

  audioPlay?.addEventListener('click', () => {
    if (!audioEl.src) return;
    if (audioEl.paused) audioEl.play().catch(()=>{});
    else audioEl.pause();
  });

  audioPause?.addEventListener('click', () => {
    if (!audioEl.src) return;
    audioEl.pause();
  });

  audioStop?.addEventListener('click', () => {
    if (!audioEl.src) return;
    stopAudio();
  });

  audioClose?.addEventListener('click', () => {
    hideBar();
  });

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
  document.querySelectorAll('[data-audio]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();

      const src = link.getAttribute('data-audio');
      const title = link.getAttribute('data-title') || 'Audio';

      audioTitle.textContent = title;
      if (audioMeta) audioMeta.textContent = src || '—';

      audioEl.src = src;
      audioEl.load();
      showBar();

      // Intento de autoplay (si el navegador lo bloquea, quedará listo)
      audioEl.play().catch(()=>{});
    });
  });
});
