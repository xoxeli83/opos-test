// ========================
// 1) Carga de CSV por tema
// ========================

async function cargarPreguntasCSVDesdeRuta(ruta) {
  const res = await fetch(ruta, { cache: 'no-store' });
  if (!res.ok) throw new Error(`No se pudo cargar ${ruta}`);
  const text = await res.text();
  return parseCSV(text);
}

function getTemaDesdeURL() {
  const params = new URLSearchParams(location.search);
  const tema = params.get('tema');
  const general = params.get('general');

  if (general === '1') return { modo: 'general', tema: null };
  if (tema) return { modo: 'tema', tema: Number(tema) };

  // por defecto: tema 1
  return { modo: 'tema', tema: 1 };
}

function temaToRutaCSV(temaNumero) {
  const t = String(temaNumero).padStart(2, '0'); // 01..09
  return `/data/preguntas_t${t}.csv`;
}

async function cargarPreguntasSegunModo() {
  const { modo, tema } = getTemaDesdeURL();

  if (modo === 'tema') {
    const ruta = temaToRutaCSV(tema);
    const preguntas = await cargarPreguntasCSVDesdeRuta(ruta);
    return { modo, tema, preguntas };
  }

  // modo general: cargamos todos los temas 1..9 (los que existan)
  const rutas = [];
  for (let i = 1; i <= 9; i++) rutas.push(temaToRutaCSV(i));

  const resultados = await Promise.allSettled(
    rutas.map(r => cargarPreguntasCSVDesdeRuta(r))
  );

  const todas = [];
  resultados.forEach((r) => {
    if (r.status === 'fulfilled') todas.push(...r.value);
    // si falla un tema (no existe el CSV aún), lo ignoramos
  });

  return { modo, tema: null, preguntas: todas };
}

// ========================
// 2) Parser CSV (tu versión)
// ========================

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

  const header = rows.shift().map(h => h.replace(/^"|"$/g, ''));
  return rows
    .filter(r => r.some(v => v !== ''))
    .map(r => {
      const obj = {};
      header.forEach((h, idx) => obj[h] = (r[idx] ?? '').replace(/^"|"$/g, ''));

      // normalizaciones
      obj.tema = Number(obj.tema);
      obj.correcta = String(obj.correcta || '').trim().toUpperCase();

      return obj;
    });
}

// ========================
// 3) Utilidades de selección
// ========================

function shuffle(array) {
  const a = array.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function seleccionarN(preguntas, n) {
  if (!Array.isArray(preguntas)) return [];
  if (preguntas.length <= n) return shuffle(preguntas);
  return shuffle(preguntas).slice(0, n);
}

// ========================
// 4) Mezcla de respuestas por pregunta
// ========================

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

  // seguridad: si CSV mal, no rompas
  const idx = (correctaIndex >= 0) ? correctaIndex : 0;

  return {
    id: p.id,
    tema: p.tema,
    pregunta: p.pregunta,
    ref: p.ref || '',
    opciones: mezcladas.map(o => o.text),
    correctaIndex: idx, // 0..3
  };
}

// ========================
// 5) Arranque (de momento: solo carga y prepara)
// ========================

(async function init() {
  try {
    const { modo, tema, preguntas } = await cargarPreguntasSegunModo();

    // Selección: 65 para modo general o examen; para tema, por ahora 20 (cámbialo)
    const totalDeseado = (modo === 'general') ? 65 : 20;

    const seleccion = seleccionarN(preguntas, totalDeseado);

    // Preparamos las preguntas con respuestas mezcladas
    const preguntasPreparadas = seleccion.map(prepararPreguntaParaMostrar);

    // De momento lo dejamos en consola para verificar
    console.log('Modo:', modo, 'Tema:', tema);
    console.log('Preguntas cargadas:', preguntas.length);
    console.log('Preguntas seleccionadas:', preguntasPreparadas.length);
    console.log('Ejemplo:', preguntasPreparadas[0]);

    // Aquí luego conectaremos con tu UI (pintar pregunta, navegación, puntuación)
    // window.__PREGUNTAS__ = preguntasPreparadas; // opcional para depurar

  } catch (e) {
    console.error(e);
    // Si quieres, aquí puedes pintar un error en el HTML
  }
})();
