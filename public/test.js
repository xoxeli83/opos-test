// ========================
// Config
// ========================
const EXAM_DUR_MIN = 80;
const EXAM_N = 65;
const PRACTICE_N = 20; // cámbialo si quieres (p.ej. 30)
const EXAM_SCORE_OK = 30;

// ========================
// Helpers URL / CSV
// ========================
function getModoDesdeURL() {
  const params = new URLSearchParams(location.search);
  const tema = params.get('tema');
  const general = params.get('general');

  if (general === '1') return { modo: 'exam', tema: null };
  if (tema) return { modo: 'practice', tema: Number(tema) };
  return { modo: 'practice', tema: 1 };
}

function temaToRutaCSV(temaNumero) {
  const t = String(temaNumero).padStart(2, '0');
  return `/data/preguntas_t${t}.csv`;
}

async function cargarPreguntasCSVDesdeRuta(ruta) {
  const res = await fetch(ruta, { cache: 'no-store' });
  if (!res.ok) throw new Error(`No se pudo cargar ${ruta}`);
  const text = await res.text();
  return parseCSV(text);
}

// CSV con comillas
function parseCSV(csvText) {
  const rows = [];
  let row = [];
  let cur = '';
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const ch = csvText[i];
    const next = csvText[i + 1];

    if (ch === '"' && inQuotes && next === '"') {
      cur += '"';
      i++;
      continue;
    }
    if (ch === '"') { inQuotes = !inQuotes; continue; }

    if (ch === ',' && !inQuotes) {
      row.push(cur);
      cur = '';
      continue;
    }
    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i++;
      row.push(cur);
      cur = '';
      if (row.length > 1) rows.push(row);
      row = [];
      continue;
    }
    cur += ch;
  }
  if (cur.length || row.length) {
    row.push(cur);
    if (row.length > 1) rows.push(row);
  }

  const header = rows.shift().map(h => h.trim().replace(/^"|"$/g, ''));
  return rows
    .filter(r => r.some(v => String(v).trim() !== ''))
    .map(r => {
      const obj = {};
      header.forEach((h, idx) => {
        const v = (r[idx] ?? '').trim().replace(/^"|"$/g, '');
        obj[h] = v;
      });
      obj.tema = Number(obj.tema);
      obj.correcta = String(obj.correcta || '').trim().toUpperCase(); // A/B/C/D
      return obj;
    });
}

// ========================
// Shuffle + preparar pregunta
// ========================
function shuffle(array) {
  const a = array.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function prepararPreguntaParaMostrar(p) {
  const opciones = [
    { key: 'A', text: p.a },
    { key: 'B', text: p.b },
    { key: 'C', text: p.c },
    { key: 'D', text: p.d },
  ];
  const mezcladas = shuffle(opciones);

  const correctaOriginal = String(p.correcta || '').trim().toUpperCase();
  const correctaIndex = mezcladas.findIndex(o => o.key === correctaOriginal);

  return {
    id: p.id,
    tema: p.tema,
    pregunta: p.pregunta,
    ref: p.ref || '',
    opciones: mezcladas.map(o => o.text),
    correctaIndex: correctaIndex >= 0 ? correctaIndex : 0,
  };
}

function seleccionarN(preguntas, n) {
  if (preguntas.length <= n) return shuffle(preguntas);
  return shuffle(preguntas).slice(0, n);
}

// ========================
// UI hooks (IDs esperados)
// ========================
const el = {
  qText: document.getElementById('qText'),
  options: document.getElementById('options'),
  feedback: document.getElementById('feedback'),
  progress: document.getElementById('progress'),
  answeredCount: document.getElementById('answeredCount'),
  btnPrev: document.getElementById('btnPrev'),
  btnNext: document.getElementById('btnNext'),
  btnFinish: document.getElementById('btnFinish'),
  btnReset: document.getElementById('btnReset'),
  timer: document.getElementById('timer'),
};

function assertUI() {
  const needed = ['qText', 'options', 'progress', 'answeredCount', 'btnPrev', 'btnNext', 'btnFinish', 'btnReset'];
  const missing = needed.filter(k => !el[k]);
  if (missing.length) {
    console.error('Faltan IDs en test.html:', missing);
    // No rompemos, pero no pintará bien.
  }
}

// ========================
// Estado
// ========================
let modo = 'practice'; // practice | exam
let tema = null;

let preguntas = [];        // ya preparadas (con opciones mezcladas)
let idx = 0;

let respuestas = [];       // por índice: null o 0..3
let bloqueadas = [];       // practice: para no cambiar tras ver feedback
let examEndsAt = null;
let timerInt = null;

// ========================
// Render
// ========================
function render() {
  const q = preguntas[idx];
  if (!q) return;

  // Texto pregunta
  if (el.qText) el.qText.textContent = q.pregunta || '(sin texto)';

  // Progreso
  const total = preguntas.length;
  const respondidas = respuestas.filter(v => v !== null).length;
  if (el.progress) el.progress.textContent = `${idx + 1}/${total}`;
  if (el.answeredCount) el.answeredCount.textContent = `${respondidas} respondidas`;

  // Feedback
  if (el.feedback) {
    if (modo === 'practice' && respuestas[idx] !== null) {
      const elegido = respuestas[idx];
      const ok = elegido === q.correctaIndex;
      const correctaTexto = q.opciones[q.correctaIndex];
      el.feedback.innerHTML = ok
        ? `✅ Correcta`
        : `❌ Incorrecta. <b>Correcta:</b> ${escapeHtml(correctaTexto)}`;
    } else {
      el.feedback.textContent = '';
    }
  }

  // Opciones
  if (el.options) {
    el.options.innerHTML = '';
    q.opciones.forEach((txt, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'opt';
      btn.textContent = txt;

      // marcado
      if (respuestas[idx] === i) btn.classList.add('selected');

      // en practice, si ya está respondida, bloqueamos cambios
      const locked = (modo === 'practice' && bloqueadas[idx] === true);
      btn.disabled = locked;

      btn.addEventListener('click', () => onSelect(i));
      el.options.appendChild(btn);
    });
  }

  // Botones
  if (el.btnPrev) el.btnPrev.disabled = idx === 0;
  if (el.btnNext) el.btnNext.disabled = idx === preguntas.length - 1;

  // En examen, mostrar timer; en practice no
  if (el.timer) {
    el.timer.style.display = (modo === 'exam') ? 'block' : 'none';
  }
}

function onSelect(optionIndex) {
  const q = preguntas[idx];

  // practice: al seleccionar, se bloquea y se muestra feedback
  if (modo === 'practice') {
    if (bloqueadas[idx]) return;

    respuestas[idx] = optionIndex;
    bloqueadas[idx] = true;
    render();
    return;
  }

  // exam: solo guarda (se puede cambiar hasta finalizar)
  respuestas[idx] = optionIndex;
  render();
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

// ========================
// Navegación
// ========================
function prev() {
  if (idx > 0) { idx--; render(); }
}
function next() {
  if (idx < preguntas.length - 1) { idx++; render(); }
}

// ========================
// Examen: timer + scoring
// ========================
function startExamTimer() {
  examEndsAt = Date.now() + EXAM_DUR_MIN * 60 * 1000;
  tickTimer();
  timerInt = setInterval(tickTimer, 250);
}

function tickTimer() {
  if (!el.timer) return;

  const ms = examEndsAt - Date.now();
  if (ms <= 0) {
    el.timer.textContent = '00:00';
    clearInterval(timerInt);
    timerInt = null;
    finalizar(); // auto-fin
    return;
  }
  const totalSec = Math.floor(ms / 1000);
  const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const ss = String(totalSec % 60).padStart(2, '0');
  el.timer.textContent = `${mm}:${ss}`;
}

function calcularNotaExamen() {
  let aciertos = 0;
  let fallos = 0;
  let blancos = 0;

  preguntas.forEach((q, i) => {
    const r = respuestas[i];
    if (r === null) { blancos++; return; }
    if (r === q.correctaIndex) aciertos++;
    else fallos++;
  });

  const nota = aciertos * 1 + fallos * (-0.25) + blancos * 0;
  return { aciertos, fallos, blancos, nota };
}

function finalizar() {
  if (modo === 'practice') {
    // practice: no hay nota global obligatoria; puedes poner un resumen si quieres
    alert('Test del tema finalizado.');
    return;
  }

  // examen
  const { aciertos, fallos, blancos, nota } = calcularNotaExamen();
  const apto = nota >= EXAM_SCORE_OK;

  alert(
    `Resultado examen (65):\n` +
    `Aciertos: ${aciertos}\n` +
    `Fallos: ${fallos}\n` +
    `Blancos: ${blancos}\n` +
    `Nota: ${nota.toFixed(2)}\n\n` +
    `${apto ? '✅ APTO' : '❌ NO APTO'} (mínimo ${EXAM_SCORE_OK})`
  );
}

function reset() {
  if (timerInt) { clearInterval(timerInt); timerInt = null; }
  idx = 0;
  respuestas = preguntas.map(() => null);
  bloqueadas = preguntas.map(() => false);

  if (modo === 'exam') startExamTimer();
  render();
}

// ========================
// Init
// ========================
(async function init() {
  assertUI();

  const info = getModoDesdeURL();
  modo = info.modo;
  tema = info.tema;

  // cargar CSV
  let base = [];
  if (modo === 'practice') {
    const ruta = temaToRutaCSV(tema);
    base = await cargarPreguntasCSVDesdeRuta(ruta);
    base = seleccionarN(base, PRACTICE_N);
  } else {
    // examen: cargar todos los temas existentes (1..9)
    const rutas = [];
    for (let i = 1; i <= 9; i++) rutas.push(temaToRutaCSV(i));

    const results = await Promise.allSettled(rutas.map(r => cargarPreguntasCSVDesdeRuta(r)));
    const todas = [];
    results.forEach(r => { if (r.status === 'fulfilled') todas.push(...r.value); });

    base = seleccionarN(todas, EXAM_N);
  }

  // preparar (mezcla respuestas)
  preguntas = base.map(prepararPreguntaParaMostrar);

  // estado inicial
  respuestas = preguntas.map(() => null);
  bloqueadas = preguntas.map(() => false);
  idx = 0;

  // bind botones
  if (el.btnPrev) el.btnPrev.addEventListener('click', prev);
  if (el.btnNext) el.btnNext.addEventListener('click', next);
  if (el.btnFinish) el.btnFinish.addEventListener('click', finalizar);
  if (el.btnReset) el.btnReset.addEventListener('click', reset);

  // timer solo en examen
  if (modo === 'exam') startExamTimer();
  render();
})();
