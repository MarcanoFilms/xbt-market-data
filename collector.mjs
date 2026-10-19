#!/usr/bin/env node
// Archivador de velas del mercado XBT — captura la ventana que expone la API
// del exchange (máx 1000 velas/petición, sin paginación) y la acumula en CSVs
// mensuales deduplicados. Ejecutado por systemd timer; commit+push si hay cambios.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

const CONFIG = {
  exchanges: {
    neoxa: {
      base: 'https://neoxa.exchange/api',
      pairs: ['BTCB2_BTC', 'BTCB2_USDC'],
      intervals: ['1m', '5m', '15m', '1h', '4h', '1d'],
      limit: 1000,
    },
  },
  push: process.env.XBT_DATA_NO_PUSH !== '1',
};

async function fetchCandles(base, pair, interval, limit) {
  const r = await fetch(`${base}/exchange/candles/${pair}?interval=${interval}&limit=${limit}`,
    { signal: AbortSignal.timeout(20000) });
  const d = await r.json();
  if (!r.ok || d.success === false || d.error) throw new Error(d.error || `HTTP ${r.status}`);
  return d.candles || [];
}

const monthOf = ts => {
  const d = new Date(ts * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

function loadCsv(file) {
  const map = new Map();
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n').slice(1)) {
      if (!line.trim()) continue;
      const t = Number(line.slice(0, line.indexOf(',')));
      if (t) map.set(t, line.trim());
    }
  }
  return map;
}

function saveCsv(file, map) {
  const rows = [...map.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1]);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'time,open,high,low,close,volume\n' + rows.join('\n') + '\n');
}

const row = c => `${c.time},${c.open},${c.high},${c.low},${c.close},${c.volume}`;

const metaFile = path.join(ROOT, 'meta.json');
const meta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')) : { series: {} };

let totalNew = 0;
for (const [exName, ex] of Object.entries(CONFIG.exchanges)) {
  for (const pair of ex.pairs) {
    for (const interval of ex.intervals) {
      const key = `${exName}/${pair}/${interval}`;
      try {
        const candles = await fetchCandles(ex.base, pair, interval, ex.limit);
        if (!candles.length) { console.log(`${key}: 0 velas`); continue; }
        // agrupar por fichero mensual y mergear (dedupe por timestamp;
        // la última versión de una vela pisa a la anterior)
        const byMonth = new Map();
        for (const c of candles) {
          const m = monthOf(c.time);
          if (!byMonth.has(m)) byMonth.set(m, []);
          byMonth.get(m).push(c);
        }
        let added = 0;
        for (const [month, list] of byMonth) {
          const file = path.join(ROOT, 'data', exName, pair, interval, `${month}.csv`);
          const map = loadCsv(file);
          const before = map.size;
          for (const c of list) map.set(c.time, row(c));
          saveCsv(file, map);
          added += map.size - before;
        }
        const s = meta.series[key] || {};
        s.oldest = Math.min(s.oldest ?? Infinity, candles[0].time);
        s.newest = Math.max(s.newest ?? 0, candles[candles.length - 1].time);
        meta.series[key] = s;
        totalNew += added;
        console.log(`${key}: ${candles.length} velas de la API, +${added} nuevas`);
      } catch (e) {
        console.log(`${key}: ERROR ${e.message}`);
      }
    }
  }
}

meta.lastRun = new Date().toISOString();
fs.writeFileSync(metaFile, JSON.stringify(meta, null, 1));

// commit + push si hay cambios
const git = args => execFileSync('git', args, { cwd: ROOT }).toString();
try {
  git(['add', '-A']);
  if (git(['status', '--porcelain']).trim()) {
    git(['commit', '-q', '-m', `velas: +${totalNew} nuevas (${new Date().toISOString().slice(0, 16)}Z)`]);
    if (CONFIG.push) {
      try { git(['push', '-q']); console.log('push OK'); }
      catch (e) { console.log(`push falló (se reintenta en la próxima pasada): ${e.message}`); }
    }
    console.log(`commit: +${totalNew} velas nuevas`);
  } else {
    console.log('sin cambios');
  }
} catch (e) {
  console.log(`git: ${e.message}`);
}
