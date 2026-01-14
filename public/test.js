/* =========================
   Opos Test — test.js
   - Tests por tema: preguntas aleatorias SIN repetirse + feedback inmediato (sin penalización)
   - Test general (65): mezcla de temas + penalización -0,25 + cronómetro 80 min
   - Selección se guarda en sessionStorage para que NO cambie al refrescar
   - CSV por tema: /data/preguntas_t01.csv, /data/preguntas_t02.csv, ...
   ========================= */

/* ---------- CONFIG ---------- */
const CONFIG = {
  temaCountDefault: 20,

  generalCount: 65,
  generalTimeSeconds: 80 * 60,
  generalPenalty: 0.25,
  generalPassScore: 30,

  generalDistribution: { 1: 10, 2: 6, 3: 8, 4: 8, 5: 8, 6: 8, 7: 6, 8: 6, 9: 5 },

  csvPathByTema: (temaNum) => `/data/preguntas_t${String(temaNum).padStart(2, '0')}.csv`,
};

/* ---------- DOM ---------- */
const $ = (id) => document.getElementById(id);

const els = {
  testTitle: $('testTitle'),
  testRules: $('testRules'),
  timeLeft: $('timeLeft'),

  idxNow: $('idxNow'),
  idxTotal: $('idxTotal'),
  answeredCount: $('answeredCount'),
  navGrid: $('navGrid'),

  qBadge: $('qBadge'),
  qMeta: $('qMeta'),
  qText: $('qText'),
  options: $('options'),

  btnPrev: $('btnPrev'),
  btnNext: $('btnNext'),
  btnFinish: $('btnFinish'),
  btnReset: $('btnReset'),

  resultBox: $('resultBox'),
  rOk: $('rOk'),
  rBad: $('rBad'),
  rBlank: $('rBlank'),
  rScore: $('rScore'),
  passLine: $('passLine'),
  btnDownload: $('btnDownload'),
  review: $('review'),
};

/* ---------- STATE ---------- */
let MODE = 'tema'; // 'tema' | 'general'
let TEMA = null;   // 1..9 si MODE=tema
let QUESTIONS = [];
let currentIndex = 0;

let answers = [];
let locked = [];

let timer = null;
let secondsLeft = 0;

/* =========================
   UTILIDADES
   ========================= */

function getQuery() {
  const params = new URLSearchParams(location.search);
  const tema = params.get('tema');
  const general = params.get('general');
  return { tema: tema ? Number(tema) : null, general: general === '1' };
}

function sessionKey() {
  if (MODE === 'general') return `opostest_selection_general_v1`;
  return `opostest_selection_tema_${String(TEMA).padStart(2, '0')}_v1`;
}

function safeJSONParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

function shuffle(array) {
  const a = array.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/* =========================
   CSV LOADER (robusto encoding + delimiter)
   ========================= */

async function cargarPreguntasCSV(path) {
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) throw new Error(`No se pudo cargar ${path}`);

  // Leemos como bytes para poder decodificar bien
  const buf = await res.arrayBuffer();

  // 1) Intento UTF-8
  let text = new TextDecoder('utf-8', { fatal: false }).decode(buf);

  // Si hay muchos caracteres de reemplazo, probamos ISO-8859-1 (latin1)
  // (esto suele arreglar "d�a", "M�ximo", etc.)
  const replacementCount = (text.match(/\uFFFD/g) || []).length;
  if (replacementCount > 0) {
    const textLatin1 = new TextDecoder('iso-8859-1', { fatal: false }).decode(buf);
    // elegimos el que tenga menos reemplazos
    const rep2 = (textLatin1.match(/\uFFFD/g) || []).length;
    if (rep2 < replacementCount) text = textLatin1;
  }

  // quitar BOM si existiera
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  return parseCSV(text);
}

// CSV simple con comillas, autodetección , o ;
function parseCSV(csvText) {
  const firstLine = (csvText.split(/\r?\n/)[0] || '');
  const delimiter = detectDelimiter(firstLine);

  const rows = [];
  let row = [];
  let cur = '';
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const ch = csvText[i];
    const next = csvText[i + 1];

    if (ch === '"' && inQuotes && next === '"') { cur += '"'; i++; continue; }
    if (ch === '"') { inQuotes = !inQuotes; continue; }

    if (ch === delimiter && !inQuotes) {
      row.push(cur.trim());
      cur = '';
      continue;
    }
    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i++;
      row.push(cur.trim());
      cur = '';
      if (row.length > 1) rows.push(row);
      row = [];
      continue;
    }
    cur += ch;
  }
  if (cur.length || row.length) {
    row.push(cur.trim());
    if (row.length > 1) rows.push(row);
  }

  const header = (rows.shift() || []).map(h => h.replace(/^"|"$/g, ''));

  const out = rows
    .filter(r => r.some(v => v !== ''))
    .map(r => {
      const obj = {};
      header.forEach((h, idx) => obj[h] = (r[idx] ?? '').replace(/^"|"$/g, ''));

      // normalizar
      obj.tema = Number(obj.tema);
      obj.correcta = String(obj.correcta || '').trim().toUpperCase();

      return obj;
    })
    // filtramos filas inválidas (si no hay id/pregunta/opciones)
    .filter(o =>
      o.id && o.pregunta &&
      (o.a || o.b || o.c || o.d) &&
      ['A', 'B', 'C', 'D'].includes(o.correcta)
    );

  return out;
}

function detectDelimiter(line) {
  // si hay ; y no hay , (o hay muchos más ;)
  const commas = (line.match(/,/g) || []).length;
  const semis = (line.match(/;/g) || []).length;
  if (semis > commas) return ';';
  return ',';
}

/* =========================
   PREPARAR PREGUNTA
   ========================= */

function prepararPreguntaParaMostrar(p) {
  const opciones = [
    { key: 'A', text: p.a },
    { key: 'B', text: p.b },
    { key: 'C', text: p.c },
    { key: 'D', text: p.d },
  ];

  const mezcladas = shuffle(opciones);

  const correctaOriginal = String(p.correcta || '').trim().toUpperCase();
  const correctaMezcladaIndex = mezcladas.findIndex(o => o.key === correctaOriginal);

  return {
    id: p.id,
    tema: p.tema,
    pregunta: p.pregunta,
    ref: p.ref || '',
    opciones: mezcladas.map(o => o.text),
    correctaIndex: correctaMezcladaIndex,
  };
}

/* =========================
   SELECCIÓN + Persistencia
   ========================= */

function guardarSeleccionEnSession(data) {
  sessionStorage.setItem(sessionKey(), JSON.stringify(data));
}

function cargarSeleccionDeSession() {
  return safeJSONParse(sessionStorage.getItem(sessionKey()));
}

function limpiarSessionSeleccion() {
  sessionStorage.removeItem(sessionKey());
}

function buildSelectionTema(preguntasTema, count) {
  const seleccion = shuffle(preguntasTema).slice(0, Math.min(count, preguntasTema.length));
  return {
    mode: 'tema',
    tema: TEMA,
    ids: seleccion.map(p => p.id),
  };
}

function buildSelectionGeneral(allByTema, distribution) {
  const temas = Object.keys(distribution).map(Number);

  const picked = [];
  for (const t of temas) {
    const wanted = distribution[t] || 0;
    const list = allByTema[t] || [];
    const sel = shuffle(list).slice(0, Math.min(wanted, list.length));
    picked.push(...sel);
  }

  const needed = CONFIG.generalCount - picked.length;
  if (needed > 0) {
    const pickedIds = new Set(picked.map(p => p.id));
    const pool = [];
    for (const t of temas) {
      for (const p of (allByTema[t] || [])) {
        if (!pickedIds.has(p.id)) pool.push(p);
      }
    }
    const fill = shuffle(pool).slice(0, Math.min(needed, pool.length));
    picked.push(...fill);
  }

  const final = shuffle(picked).slice(0, CONFIG.generalCount);

  return {
    mode: 'general',
    ids: final.map(p => p.id),
  };
}

function aplicarSeleccion(preguntasCargadas, selection) {
  const map = new Map(preguntasCargadas.map(p => [p.id, p]));
  const ordered = selection.ids.map(id => map.get(id)).filter(Boolean);
  return ordered;
}

/* =========================
   UI / RENDER
   ========================= */

function setModeUI() {
  if (MODE === 'general') {
    els.testTitle.textContent = 'Test';
    els.testRules.textContent = '80 min · 4 opciones · +1 acierto · −0,25 fallo · 0 blanco · APTO ≥ 30';
    secondsLeft = CONFIG.generalTimeSeconds;
    els.timeLeft.textContent = formatTime(secondsLeft);
    startTimer();
  } else {
    els.testTitle.textContent = `Test Tema ${TEMA}`;
    els.testRules.textContent = '4 opciones · feedback inmediato · sin penalización';
    stopTimer();
    els.timeLeft.textContent = '—';
  }
}

function renderNavGrid() {
  els.navGrid.innerHTML = '';
  for (let i = 0; i < QUESTIONS.length; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mini';
    b.textContent = String(i + 1);
    b.addEventListener('click', () => goTo(i));
    els.navGrid.appendChild(b);
  }
  updateProgressUI();
}

function updateProgressUI() {
  els.idxNow.textContent = String(currentIndex + 1);
  els.idxTotal.textContent = String(QUESTIONS.length);

  const answered = answers.filter(v => v !== null && v !== undefined).length;
  els.answeredCount.textContent = String(answered);

  const minis = els.navGrid.querySelectorAll('.mini');
  minis.forEach((btn, i) => {
    const isAnswered = answers[i] !== null && answers[i] !== undefined;
    btn.classList.toggle('current', i === currentIndex);

    // Quitamos estilos inline previos
    btn.style.background = '';
    btn.style.borderColor = '';
    btn.style.color = '';

    // Mantén tu estilo de "answered" si lo tienes en CSS
    btn.classList.toggle('answered', isAnswered);

    // NUEVO: en modo tema, si está bloqueada, pintamos OK/KO
    if (MODE === 'tema' && locked[i] === true && isAnswered && QUESTIONS[i]) {
      const ok = answers[i] === QUESTIONS[i].correctaIndex;
      if (ok) {
        btn.style.background = 'rgba(60,255,180,.22)';
        btn.style.borderColor = 'rgba(60,255,180,.65)';
        btn.style.color = '#fff';
      } else {
        btn.style.background = 'rgba(255,120,120,.22)';
        btn.style.borderColor = 'rgba(255,120,120,.65)';
        btn.style.color = '#fff';
      }
    }
  });
}

function renderQuestion() {
  const q = QUESTIONS[currentIndex];
  if (!q) return;

  els.qText.textContent = q.pregunta || '(sin enunciado)';
  els.qMeta.textContent = `${q.id}${q.ref ? ' · ' + q.ref : ''}`;
  els.qBadge.textContent = 'Pregunta';

  els.options.innerHTML = '';

  const selected = answers[currentIndex];
  const isLocked = locked[currentIndex] === true;

  q.opciones.forEach((text, idx) => {
    const label = document.createElement('label');
    label.className = 'opt';

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'opt';
    input.value = String(idx);
    input.checked = selected === idx;
    input.disabled = isLocked;

    const content = document.createElement('div');

    const l = document.createElement('div');
    l.className = 'label';
    l.textContent = String.fromCharCode(65 + idx) + '.';

    const t = document.createElement('div');
    t.className = 'text';
    t.textContent = text || '';

    content.appendChild(l);
    content.appendChild(t);

    label.appendChild(input);
    label.appendChild(content);

    label.addEventListener('click', () => {
      if (MODE === 'tema' && locked[currentIndex]) return;
      selectAnswer(idx);
    });

    els.options.appendChild(label);
  });

  if (MODE === 'tema' && locked[currentIndex]) {
    applyImmediateFeedbackStyles();
  }
}

function applyImmediateFeedbackStyles() {
  const q = QUESTIONS[currentIndex];
  const selected = answers[currentIndex];
  const correct = q.correctaIndex;

  const opts = els.options.querySelectorAll('.opt');
  opts.forEach((optEl, idx) => {
    optEl.style.background = '';
    optEl.style.borderColor = '';
    optEl.style.color = '';

    const textEl = optEl.querySelector('.text');
    if (textEl) textEl.style.color = 'var(--text)';

    if (idx === correct) {
      optEl.style.background = 'rgba(60,255,180,.18)';
      optEl.style.borderColor = 'rgba(60,255,180,.55)';
      if (textEl) textEl.style.color = '#fff';
    }
    if (selected === idx && selected !== correct) {
      optEl.style.background = 'rgba(255,120,120,.18)';
      optEl.style.borderColor = 'rgba(255,120,120,.55)';
      if (textEl) textEl.style.color = '#fff';
    }
    if (selected === idx && selected === correct) {
      optEl.style.background = 'rgba(60,255,180,.26)';
      optEl.style.borderColor = 'rgba(60,255,180,.70)';
      if (textEl) textEl.style.color = '#fff';
    }
  });
}

/* =========================
   NAV / ANSWERS
   ========================= */

function goTo(i) {
  currentIndex = clamp(i, 0, QUESTIONS.length - 1);
  updateProgressUI();
  renderQuestion();
}

function next() { if (currentIndex < QUESTIONS.length - 1) goTo(currentIndex + 1); }
function prev() { if (currentIndex > 0) goTo(currentIndex - 1); }

function selectAnswer(idx) {
  answers[currentIndex] = idx;

  if (MODE === 'tema') {
    locked[currentIndex] = true;
  }

  updateProgressUI();
  renderQuestion();
}

/* =========================
   TIMER (solo general)
   ========================= */

function startTimer() {
  stopTimer();
  timer = setInterval(() => {
    secondsLeft--;
    if (secondsLeft < 0) {
      secondsLeft = 0;
      els.timeLeft.textContent = formatTime(secondsLeft);
      stopTimer();
      finishTest();
      return;
    }
    els.timeLeft.textContent = formatTime(secondsLeft);
  }, 1000);
}

function stopTimer() {
  if (timer) clearInterval(timer);
  timer = null;
}

/* =========================
   SCORE / RESULTADOS
   ========================= */

function computeResults() {
  let ok = 0, bad = 0, blank = 0;

  for (let i = 0; i < QUESTIONS.length; i++) {
    const q = QUESTIONS[i];
    const a = answers[i];

    if (a === null || a === undefined) { blank++; continue; }
    if (a === q.correctaIndex) ok++;
    else bad++;
  }

  let score = ok;
  if (MODE === 'general') score = ok - bad * CONFIG.generalPenalty;

  return { ok, bad, blank, score };
}

function finishTest() {
  const { ok, bad, blank, score } = computeResults();

  els.rOk.textContent = String(ok);
  els.rBad.textContent = String(bad);
  els.rBlank.textContent = String(blank);
  els.rScore.textContent = String(score.toFixed(2)).replace('.00', '');

  if (MODE === 'general') {
    const pass = score >= CONFIG.generalPassScore;
    els.passLine.textContent = pass ? `APTO (≥ ${CONFIG.generalPassScore})` : `NO APTO (< ${CONFIG.generalPassScore})`;
    els.passLine.className = `passline ${pass ? 'pass-ok' : 'pass-bad'}`;
  } else {
    els.passLine.textContent = '—';
    els.passLine.className = 'passline';
  }

  renderReview();

  els.resultBox.classList.remove('hidden');
  document.querySelector('.test-shell')?.classList.add('hidden');
  document.querySelector('.test-header')?.classList.add('hidden');
}

function renderReview() {
  els.review.innerHTML = '';

  for (let i = 0; i < QUESTIONS.length; i++) {
    const q = QUESTIONS[i];
    const a = answers[i];
    const correct = q.correctaIndex;

    const box = document.createElement('div');
    box.className = 'rev';

    const top = document.createElement('div');
    top.className = 'top';

    const left = document.createElement('div');
    left.innerHTML = `<strong>${i + 1}.</strong> <span class="muted">${q.id}</span>`;

    const right = document.createElement('div');
    right.className = 'ans';

    if (a === null || a === undefined) {
      box.classList.add('blank');
      right.textContent = 'Blanco';
    } else if (a === correct) {
      box.classList.add('ok');
      right.textContent = 'Correcta';
    } else {
      box.classList.add('bad');
      right.textContent = 'Incorrecta';
    }

    top.appendChild(left);
    top.appendChild(right);

    const qtxt = document.createElement('div');
    qtxt.textContent = q.pregunta;

    const correctTxt = q.opciones[correct];
    const userTxt = (a === null || a === undefined) ? '—' : q.opciones[a];

    const detail = document.createElement('div');
    detail.className = 'muted';
    detail.innerHTML = `Tu respuesta: <strong>${escapeHtml(userTxt)}</strong><br/>Correcta: <strong>${escapeHtml(correctTxt)}</strong>`;

    box.appendChild(top);
    box.appendChild(qtxt);
    box.appendChild(detail);

    els.review.appendChild(box);
  }
}

function escapeHtml(str) {
  return String(str || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function downloadAnswers() {
  const lines = [];
  lines.push('num,id,tema,seleccion,correcta,ok');
  for (let i = 0; i < QUESTIONS.length; i++) {
    const q = QUESTIONS[i];
    const a = answers[i];
    const correct = q.correctaIndex;

    const selLetter = (a === null || a === undefined) ? '' : String.fromCharCode(65 + a);
    const corLetter = String.fromCharCode(65 + correct);
    const ok = (a === null || a === undefined) ? '' : (a === correct ? '1' : '0');

    lines.push([i + 1, q.id, q.tema, selLetter, corLetter, ok].join(','));
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = MODE === 'general' ? 'respuestas_test_general.csv' : `respuestas_tema_${pad2(TEMA)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* =========================
   RESET
   ========================= */

function resetTest({ newSelection } = { newSelection: false }) {
  if (newSelection) limpiarSessionSeleccion();
  init();
}

/* =========================
   INIT
   ========================= */

async function loadTemaRaw(temaNum) {
  const path = CONFIG.csvPathByTema(temaNum);
  return await cargarPreguntasCSV(path);
}

async function init() {
  const q = getQuery();

  MODE = q.general ? 'general' : 'tema';
  TEMA = q.tema && !q.general ? q.tema : null;

  if (MODE === 'tema' && (!TEMA || TEMA < 1 || TEMA > 9)) {
    location.href = '/';
    return;
  }

  setModeUI();

  let rawAll = [];
  let selection = cargarSeleccionDeSession();

  if (MODE === 'tema') {
    const rawTema = await loadTemaRaw(TEMA);
    rawAll = rawTema;

    if (!selection || selection.mode !== 'tema' || selection.tema !== TEMA) {
      selection = buildSelectionTema(rawTema, CONFIG.temaCountDefault);
      guardarSeleccionEnSession(selection);
    }

    const selectedRaw = aplicarSeleccion(rawTema, selection);
    QUESTIONS = selectedRaw.map(prepararPreguntaParaMostrar);

    answers = Array(QUESTIONS.length).fill(null);
    locked = Array(QUESTIONS.length).fill(false);

  } else {
    const allByTema = {};
    for (let t = 1; t <= 9; t++) {
      try {
        allByTema[t] = await loadTemaRaw(t);
        rawAll.push(...allByTema[t]);
      } catch {
        allByTema[t] = [];
      }
    }

    if (!selection || selection.mode !== 'general') {
      selection = buildSelectionGeneral(allByTema, CONFIG.generalDistribution);
      guardarSeleccionEnSession(selection);
    }

    const selectedRaw = aplicarSeleccion(rawAll, selection);
    QUESTIONS = selectedRaw.map(prepararPreguntaParaMostrar);

    answers = Array(QUESTIONS.length).fill(null);
    locked = Array(QUESTIONS.length).fill(false);
  }

  currentIndex = 0;
  els.resultBox.classList.add('hidden');
  document.querySelector('.test-shell')?.classList.remove('hidden');
  document.querySelector('.test-header')?.classList.remove('hidden');

  renderNavGrid();
  renderQuestion();
}

/* =========================
   EVENTOS
   ========================= */

els.btnPrev?.addEventListener('click', (e) => { e.preventDefault(); prev(); });
els.btnNext?.addEventListener('click', (e) => { e.preventDefault(); next(); });

els.btnFinish?.addEventListener('click', (e) => {
  e.preventDefault();
  finishTest();
});

els.btnReset?.addEventListener('click', (e) => {
  e.preventDefault();
  resetTest({ newSelection: true });
});

els.btnDownload?.addEventListener('click', (e) => {
  e.preventDefault();
  downloadAnswers();
});

init();
