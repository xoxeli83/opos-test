// ========================
// Config
// ========================
const EXAM_DUR_MIN = 80;
const EXAM_N = 65;
const PRACTICE_N = 20; // nº preguntas por test de tema (ajústalo)
const EXAM_SCORE_OK = 30;

// ========================
// Helpers URL / CSV
// ========================
function getModoDesdeURL() {
  const params = new URLSearchParams(location.search);
  const tema = params.get("tema");
  const general = params.get("general");

  if (general === "1") return { modo: "exam", tema: null };
  if (tema) return { modo: "practice", tema: Number(tema) };
  return { modo: "practice", tema: 1 };
}

function temaToRutaCSV(temaNumero) {
  const t = String(temaNumero).padStart(2, "0");
  return `/data/preguntas_t${t}.csv`;
}

async function cargarPreguntasCSVDesdeRuta(ruta) {
  const res = await fetch(ruta, { cache: "no-store" });
  if (!res.ok) throw new Error(`No se pudo cargar ${ruta}`);
  const text = await res.text();
  return parseCSV(text);
}

// CSV con comillas (sirve para nuestro caso)
function parseCSV(csvText) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const ch = csvText[i];
    const next = csvText[i + 1];

    if (ch === '"' && inQuotes && next === '"') {
      cur += '"';
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (ch === "," && !inQuotes) {
      row.push(cur);
      cur = "";
      continue;
    }
    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && next === "\n") i++;
      row.push(cur);
      cur = "";
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

  const header = rows.shift().map((h) => h.trim().replace(/^"|"$/g, ""));
  return rows
    .filter((r) => r.some((v) => String(v).trim() !== ""))
    .map((r) => {
      const obj = {};
      header.forEach((h, idx) => {
        const v = (r[idx] ?? "").trim().replace(/^"|"$/g, "");
        obj[h] = v;
      });
      obj.tema = Number(obj.tema);
      obj.correcta = String(obj.correcta || "").trim().toUpperCase(); // A/B/C/D
      return obj;
    });
}

// ========================
// Shuffle + preparar pregunta (mezcla respuestas)
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
    { key: "A", text: p.a },
    { key: "B", text: p.b },
    { key: "C", text: p.c },
    { key: "D", text: p.d },
  ];

  const mezcladas = shuffle(opciones);

  const correctaOriginal = String(p.correcta || "").trim().toUpperCase();
  const correctaIndex = mezcladas.findIndex((o) => o.key === correctaOriginal);

  return {
    id: p.id,
    tema: p.tema,
    pregunta: p.pregunta,
    ref: p.ref || "",
    opciones: mezcladas.map((o) => o.text),
    correctaIndex: correctaIndex >= 0 ? correctaIndex : 0,
  };
}

function seleccionarN(preguntas, n) {
  if (preguntas.length <= n) return shuffle(preguntas);
  return shuffle(preguntas).slice(0, n);
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ========================
// UI hooks (según tu test.html)
// ========================
const el = {
  testTitle: document.getElementById("testTitle"),
  testRules: document.getElementById("testRules"),
  timeLeft: document.getElementById("timeLeft"),

  idxNow: document.getElementById("idxNow"),
  idxTotal: document.getElementById("idxTotal"),
  answeredCount: document.getElementById("answeredCount"),

  navGrid: document.getElementById("navGrid"),

  qBadge: document.getElementById("qBadge"),
  qMeta: document.getElementById("qMeta"),
  qText: document.getElementById("qText"),
  options: document.getElementById("options"),

  btnPrev: document.getElementById("btnPrev"),
  btnNext: document.getElementById("btnNext"),
  btnFinish: document.getElementById("btnFinish"),
  btnReset: document.getElementById("btnReset"),

  // resultado
  resultBox: document.getElementById("resultBox"),
  rOk: document.getElementById("rOk"),
  rBad: document.getElementById("rBad"),
  rBlank: document.getElementById("rBlank"),
  rScore: document.getElementById("rScore"),
  passLine: document.getElementById("passLine"),
  review: document.getElementById("review"),
  btnDownload: document.getElementById("btnDownload"),
};

function setHidden(node, hidden) {
  if (!node) return;
  node.classList.toggle("hidden", hidden);
}

// ========================
// Estado
// ========================
let modo = "practice"; // practice | exam
let tema = null;

let preguntas = []; // ya preparadas (opciones mezcladas)
let idx = 0;

let respuestas = []; // null o 0..3
let bloqueadas = []; // practice: no permitir cambiar tras responder

let examEndsAt = null;
let timerInt = null;

// ========================
// Render
// ========================
function renderNavGrid() {
  if (!el.navGrid) return;
  el.navGrid.innerHTML = "";

  preguntas.forEach((q, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "mini";
    b.textContent = String(i + 1);

    if (i === idx) b.classList.add("current");
    if (respuestas[i] !== null) b.classList.add("answered");

    b.addEventListener("click", () => {
      idx = i;
      render();
    });

    el.navGrid.appendChild(b);
  });
}

// pinta colores en opciones para PRACTICE (tema)
function aplicarColoresOpcionesPractice() {
  if (!el.options) return;

  const q = preguntas[idx];
  const r = respuestas[idx];
  if (r === null) return;

  const botones = Array.from(el.options.querySelectorAll(".opt"));

  // siempre: correcta en verde
  const btnCorrect = botones[q.correctaIndex];
  if (btnCorrect) {
    btnCorrect.classList.add("is-correct");
    btnCorrect.style.color = "#fff";
  }

  // si falló: elegida en rojo
  if (r !== q.correctaIndex) {
    const btnPicked = botones[r];
    if (btnPicked) {
      btnPicked.classList.add("is-wrong");
      btnPicked.style.color = "#fff";
    }
  } else {
    // si acertó, la elegida ya es la correcta (verde)
    const btnPicked = botones[r];
    if (btnPicked) btnPicked.style.color = "#fff";
  }

  // texto blanco en todas (para que se lea sobre rojo/verde)
  botones.forEach((b) => (b.style.color = "#fff"));
}

function render() {
  const q = preguntas[idx];
  if (!q) return;

  // título / reglas
  if (el.testTitle) {
    el.testTitle.textContent =
      modo === "exam" ? "Test General (65)" : `Test Tema ${tema}`;
  }
  if (el.testRules) {
    el.testRules.textContent =
      modo === "exam"
        ? "80 min · 4 opciones · +1 acierto · −0,25 fallo · 0 blanco · APTO ≥ 30"
        : "4 opciones · feedback inmediato · sin penalización";
  }

  // timer (solo examen)
  if (el.timeLeft) {
    const box = el.timeLeft.closest(".timer");
    if (box) box.style.display = modo === "exam" ? "block" : "none";
  }

  // progreso
  const total = preguntas.length;
  const respondidas = respuestas.filter((v) => v !== null).length;
  if (el.idxNow) el.idxNow.textContent = String(idx + 1);
  if (el.idxTotal) el.idxTotal.textContent = String(total);
  if (el.answeredCount) el.answeredCount.textContent = String(respondidas);

  // cabecera pregunta
  if (el.qBadge) el.qBadge.textContent = `Pregunta`;
  if (el.qMeta) {
    el.qMeta.textContent = q.id ? `${q.id}${q.ref ? " · " + q.ref : ""}` : "";
  }

  // enunciado
  if (el.qText) el.qText.textContent = q.pregunta || "(sin texto)";

  // opciones (botones)
  if (el.options) {
    el.options.innerHTML = "";

    const locked = modo === "practice" && bloqueadas[idx] === true;

    q.opciones.forEach((txt, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "opt";
      btn.textContent = txt;

      // forzar texto blanco (tu fondo es oscuro)
      btn.style.color = "#fff";

      if (respuestas[idx] === i) btn.classList.add("selected");

      btn.disabled = locked;

      btn.addEventListener("click", () => onSelect(i));
      el.options.appendChild(btn);
    });

    // si ya respondió en practice, colorear (verde/rojo)
    if (modo === "practice" && respuestas[idx] !== null) {
      aplicarColoresOpcionesPractice();
    }
  }

  // nav grid
  renderNavGrid();

  // botones
  if (el.btnPrev) el.btnPrev.disabled = idx === 0;
  if (el.btnNext) el.btnNext.disabled = idx === preguntas.length - 1;
}

// ========================
// Eventos
// ========================
function onSelect(optionIndex) {
  const q = preguntas[idx];

  if (modo === "practice") {
    if (bloqueadas[idx]) return;

    respuestas[idx] = optionIndex;
    bloqueadas[idx] = true;

    // render para deshabilitar y luego colorear
    render();
    return;
  }

  // examen: permitir cambiar hasta finalizar
  respuestas[idx] = optionIndex;
  render();
}

function prev() {
  if (idx > 0) {
    idx--;
    render();
  }
}

function next() {
  if (idx < preguntas.length - 1) {
    idx++;
    render();
  }
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
  if (!el.timeLeft) return;

  const ms = examEndsAt - Date.now();
  if (ms <= 0) {
    el.timeLeft.textContent = "00:00";
    clearInterval(timerInt);
    timerInt = null;
    finalizar(); // auto-fin
    return;
  }

  const totalSec = Math.floor(ms / 1000);
  const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const ss = String(totalSec % 60).padStart(2, "0");
  el.timeLeft.textContent = `${mm}:${ss}`;
}

function calcularNotaExamen() {
  let aciertos = 0;
  let fallos = 0;
  let blancos = 0;

  preguntas.forEach((q, i) => {
    const r = respuestas[i];
    if (r === null) {
      blancos++;
      return;
    }
    if (r === q.correctaIndex) aciertos++;
    else fallos++;
  });

  const nota = aciertos * 1 + fallos * -0.25 + blancos * 0;
  return { aciertos, fallos, blancos, nota };
}

// ========================
// Resultado / revisión (solo examen)
// ========================
function buildReviewExam() {
  if (!el.review) return;
  el.review.innerHTML = "";

  preguntas.forEach((q, i) => {
    const r = respuestas[i];
    const ok = r !== null && r === q.correctaIndex;

    const box = document.createElement("div");
    box.className = "rev";
    if (r === null) box.classList.add("blank");
    else if (ok) box.classList.add("ok");
    else box.classList.add("bad");

    const top = document.createElement("div");
    top.className = "top";
    top.innerHTML = `<div><b>${i + 1}.</b> ${escapeHtml(q.pregunta)}</div><div class="ans">${r === null ? "BLANCO" : ok ? "OK" : "FALLO"}</div>`;
    box.appendChild(top);

    const correct = document.createElement("div");
    correct.className = "muted";
    correct.textContent = `Correcta: ${q.opciones[q.correctaIndex]}`;
    box.appendChild(correct);

    el.review.appendChild(box);
  });
}

function showResultBox({ aciertos, fallos, blancos, nota }) {
  setHidden(el.resultBox, false);

  if (el.rOk) el.rOk.textContent = String(aciertos);
  if (el.rBad) el.rBad.textContent = String(fallos);
  if (el.rBlank) el.rBlank.textContent = String(blancos);
  if (el.rScore) el.rScore.textContent = nota.toFixed(2);

  const apto = nota >= EXAM_SCORE_OK;
  if (el.passLine) {
    el.passLine.textContent = apto
      ? `✅ APTO (≥ ${EXAM_SCORE_OK})`
      : `❌ NO APTO (mínimo ${EXAM_SCORE_OK})`;
    el.passLine.classList.toggle("pass-ok", apto);
    el.passLine.classList.toggle("pass-bad", !apto);
  }

  buildReviewExam();
}

// descarga respuestas (simple JSON)
function downloadAnswers() {
  const data = {
    modo,
    tema,
    fecha: new Date().toISOString(),
    preguntas: preguntas.map((q, i) => ({
      num: i + 1,
      id: q.id,
      enunciado: q.pregunta,
      opciones: q.opciones,
      correctaIndex: q.correctaIndex,
      respuestaIndex: respuestas[i],
    })),
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download =
    modo === "exam" ? "respuestas_examen.json" : `respuestas_tema_${tema}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

// ========================
// Acciones
// ========================
function finalizar() {
  if (modo === "practice") {
    alert("Test del tema finalizado.");
    return;
  }

  const res = calcularNotaExamen();
  showResultBox(res);
}

function reset() {
  if (timerInt) {
    clearInterval(timerInt);
    timerInt = null;
  }

  idx = 0;
  respuestas = preguntas.map(() => null);
  bloqueadas = preguntas.map(() => false);

  setHidden(el.resultBox, true);

  if (modo === "exam") startExamTimer();
  render();
}

// ========================
// Init
// ========================
(async function init() {
  const info = getModoDesdeURL();
  modo = info.modo;
  tema = info.tema;

  let base = [];

  if (modo === "practice") {
    const ruta = temaToRutaCSV(tema);
    base = await cargarPreguntasCSVDesdeRuta(ruta);
    base = seleccionarN(base, PRACTICE_N);
  } else {
    const rutas = [];
    for (let i = 1; i <= 9; i++) rutas.push(temaToRutaCSV(i));

    const results = await Promise.allSettled(
      rutas.map((r) => cargarPreguntasCSVDesdeRuta(r))
    );

    const todas = [];
    results.forEach((r) => {
      if (r.status === "fulfilled") todas.push(...r.value);
    });

    base = seleccionarN(todas, EXAM_N);
  }

  preguntas = base.map(prepararPreguntaParaMostrar);
  respuestas = preguntas.map(() => null);
  bloqueadas = preguntas.map(() => false);
  idx = 0;

  if (el.btnPrev) el.btnPrev.addEventListener("click", prev);
  if (el.btnNext) el.btnNext.addEventListener("click", next);
  if (el.btnFinish) el.btnFinish.addEventListener("click", finalizar);
  if (el.btnReset) el.btnReset.addEventListener("click", reset);
  if (el.btnDownload) el.btnDownload.addEventListener("click", downloadAnswers);

  setHidden(el.resultBox, true);

  if (modo === "exam") startExamTimer();

  render();
})().catch((e) => {
  console.error(e);
  if (el.qText) el.qText.textContent = "Error cargando preguntas.";
})();
