async function cargarPreguntasCSV() {
  const res = await fetch('/data/preguntas.csv', { cache: 'no-store' });
  if (!res.ok) throw new Error('No se pudo cargar /data/preguntas.csv');

  const text = await res.text();
  return parseCSV(text);
}

// CSV simple con comillas (sirve para nuestro caso)
function parseCSV(csvText) {
  const rows = [];
  let row = [];
  let cur = '';
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const ch = csvText[i];
    const next = csvText[i + 1];

    if (ch === '"' && inQuotes && next === '"') { // escape ""
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
      obj.tema = Number(obj.tema);
      return obj;
    });
}

function filtrarPorTema(preguntas, tema) {
  return preguntas.filter(p => p.tema === Number(tema));
}

// (opcional) si quieres validar rango T01-0001..T01-0200
function filtrarRangoTema1(preguntas) {
  return preguntas.filter(p => {
    if (!p.id?.startsWith('T01-')) return false;
    const n = Number(p.id.split('-')[1]);
    return n >= 1 && n <= 200;
  });
}
