# xbt-market-data

Archivo histórico de velas del mercado **XBT (BTCB2)** — registro pionero del par XBT/BTC desde los primeros días del mercado en [neoxa.exchange](https://neoxa.exchange) (mercado creado el 2026-09-01). Actualizado automáticamente cada 15 minutos.

*Historical OHLCV archive of the XBT (BTCB2) market — a pioneer record of the XBT/BTC pair since the market's genesis (2026-09-01). The exchange API only exposes a rolling 1000-candle window; this repo preserves what would otherwise be lost. Free to use (MIT).*

Es el archivo que consume el dashboard [**Oracle Trader**](https://github.com/MarcanoFilms/oracle-trader) para mostrar la historia completa del mercado más allá de la ventana de la API.

## Por qué existe

La API del exchange solo expone una **ventana rodante de 1000 velas por intervalo** (sin paginación): el 1m caduca en ~3 días de trading, el 15m en semanas. Nadie más archiva este mercado — sin este repo, la historia fina del par se pierde para siempre. Usos:

- **Backtesting** del bot acumulador con velas reales de todo el histórico (no solo la ventana de la API)
- Registro histórico del mercado XBT/BTC desde su génesis

## Estructura

```
data/<exchange>/<par>/<intervalo>/<YYYY-MM>.csv
data/neoxa/BTCB2_BTC/1m/2026-10.csv
```

CSV: `time,open,high,low,close,volume` — `time` en epoch segundos (UTC), una fila por vela, solo períodos con trades (la API no emite velas vacías). `meta.json` lleva el rango capturado por serie y la última pasada.

Pares: `BTCB2_BTC` (el principal) y `BTCB2_USDC`. Intervalos: 1m, 5m, 15m, 1h, 4h, 1d.

## Cobertura

- **4h y 1d**: vida completa del mercado (desde 2026-09-01)
- **1h**: desde 2026-09-08
- **15m**: desde 2026-10-08
- **1m/5m**: desde 2026-10-17 en adelante, sin huecos mientras el timer corra

## Cómo corre

`collector.mjs` (Node, sin dependencias) se ejecuta cada 15 min vía systemd user timer en el Asus (`xbt-candles.timer`), mergea las velas nuevas en los CSV (dedupe por timestamp) y hace commit+push si hay cambios.

```bash
node collector.mjs                    # pasada manual
XBT_DATA_NO_PUSH=1 node collector.mjs # sin push
systemctl --user list-timers xbt-candles.timer
journalctl --user -u xbt-candles -n 30
```

## Cargar en Python (backtest)

```python
import csv, glob

def load_candles(series_dir):
    """series_dir p.ej. 'data/neoxa/BTCB2_BTC/15m' → lista de dicts ordenada."""
    rows = []
    for f in sorted(glob.glob(f"{series_dir}/*.csv")):
        with open(f) as fh:
            for r in csv.DictReader(fh):
                rows.append({k: (int(r[k]) if k == "time" else float(r[k])) for k in r})
    return rows
```

## Licencia

[MIT](LICENSE) © MarcanoFilms — datos y colector libres para cualquier uso;
se agradece la atribución si publicas algo construido sobre el archivo.
