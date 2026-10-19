---
name: "train2go-pdf-nutricionista"
description: "Genera el PDF semanal de entrenos de Pablo desde Train2Go para su nutricionista (Rubén Cuenca). Úsalo cuando pida el PDF de la semana, pase un curl de Train2Go o quiera el detalle de entrenos para el nutri."
---

> Copia para la CLI de la skill de Claude Desktop; ambas son independientes y no se sincronizan.

# PDF semanal de entrenos Train2Go → nutricionista

## Contexto
- Deportista: Pablo Albaladejo (user id Train2Go **28035**, se puede confirmar con `data-user=` en /user/index).
- Entrenador: Daniel Blanco Galindo (Dani). Nutricionista: Rubén Cuenca (CENTRO NUTRICION RUBEN CUENCA). Maru (Supermaru, su mujer) cocina y ejecuta el plan.
- Objetivo principal actual: Duatlón Vallecas, 14 mar 2027 (actualizar si cambia en /user/index).
- Rubén ajusta las cantidades según la carga de cada día, así que necesita: deporte, duración, carga, zonas/intensidad, descripción completa y cualquier mención a geles o ingesta.

## 1. Credenciales y entorno local
Pide a Pablo un "Copy as cURL" de cualquier petición de app.train2go.com (vale la de /user/index). Del flag `-b` coge la cadena de cookies (necesarias: `remember_web_*`, `XSRF-TOKEN`, `train2go_session`). Guárdala en el scratchpad como `cookies.txt` (nunca la imprimas en la salida). Si no dice qué semana, usa la semana en curso (lunes → domingo).

Usa un directorio temporal para todos los archivos intermedios: `SCRATCH=$(mktemp -d)`; guarda allí `cookies.txt`, `acts.json`, los PDF descargados y `plan.html`. Al terminar, borra el directorio temporal. El PDF final va a `~/Documents/Claude/Entrenos/` (créalo si no existe).

Si falta el entorno virtual, créalo e instala sus dependencias, sin instalar nada en el Python del sistema:
```bash
/Users/pablo/.local/bin/uv venv /Users/pablo/.claude-work/skills/train2go-pdf-nutricionista/.venv --python /opt/homebrew/bin/python3
/Users/pablo/.local/bin/uv pip install --python /Users/pablo/.claude-work/skills/train2go-pdf-nutricionista/.venv/bin/python3 beautifulsoup4 playwright
```
Los comandos de extracción y renderizado que usan bs4 o Playwright deben ejecutarse con `/Users/pablo/.claude-work/skills/train2go-pdf-nutricionista/.venv/bin/python3`.

## 2. Extraer datos
```bash
cd "$SCRATCH" && /Users/pablo/.claude-work/skills/train2go-pdf-nutricionista/.venv/bin/python3 - <<'EOF'
import json, re, subprocess, datetime, os
from bs4 import BeautifulSoup
MONDAY = '2026-09-28'   # <- lunes de la semana pedida
USER = '28035'
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36'
CK = open('cookies.txt').read().strip()
def get(url):
    r = subprocess.run(['curl','-sS','-b',CK,'-A',UA,'-H','X-Requested-With: XMLHttpRequest','-H','Accept: application/json',url],capture_output=True,text=True)
    return json.loads(r.stdout)
m = datetime.date.fromisoformat(MONDAY)
acts = []
os.makedirs('pdfs', exist_ok=True)
for i in range(7):
    day = (m + datetime.timedelta(days=i)).isoformat()
    d = get(f'https://app.train2go.com/api/v2/workplan/daily/{day}?user={USER}&source=sidebar')
    s = BeautifulSoup(d['data']['content'], 'html.parser')
    for a in s.select('div.activity[data-id]'):
        sport = a.select_one('.activity-excerpt-sport title')
        lvl = a.select_one('.workload')
        title = a.select_one('.activity-title')
        dur = a.select_one('.measured')
        links = [x['href'] for x in a.select('a[href]') if 'dropbox' in x['href']]
        for t in a(['script','style','svg','form input','button']): t.decompose()
        lines = [l for l in a.get_text('\n', strip=True).split('\n') if not re.fullmatch(r'\d{1,2}', l)]
        acts.append(dict(day=day, id=a['data-id'], sport=sport.text if sport else None,
            dur=dur.text if dur else None, level=lvl['data-value'] if lvl else None,
            title=title.get_text(strip=True) if title else None, text=lines, links=links))
        for k, l in enumerate(links):
            fn = f"pdfs/{a['data-id']}_{k}.pdf"
            subprocess.run(['curl','-sSL','-o',fn,l.replace('dl=0','dl=1')])
            acts[-1].setdefault('pdf_text', []).append(subprocess.run(['pdftotext','-layout',fn,'-'],capture_output=True,text=True).stdout)
json.dump(acts, open('acts.json','w'), indent=1, ensure_ascii=False)
for x in acts: print(x['day'], x['sport'], x['dur'], x['level'], x['title'])
EOF
```
Notas:
- Si la respuesta no es JSON o redirige a login → las cookies han caducado; pide un curl nuevo.
- La vista semanal está en `/api/v2/workplan/weekly/{lunes}?user=28035&source=default` (JSON `data.replace['#workplan']`, HTML) por si hace falta cruzar datos.
- Revisa `acts.json`: el campo `text` puede incluir ruido de la UI ("Comentar", "dropbox.com"…); quédate con la descripción real de la sesión.
- Las sesiones de gimnasio suelen llevar un PDF de Dropbox con los ejercicios, pesos, reps, RIR y vueltas: resume eso.

## 3. Interpretación (importante para Rubén)
- Los **puntitos** de Train2Go son la **carga de trabajo (1–5)** que pone el entrenador (`.workload data-value`). No son duración, y tampoco son intensidad tal cual. Las sesiones de fuerza a menudo no llevan carga (muéstralas con "—").
- Describe la intensidad a partir del contenido: zonas (Z1–Z5), ritmos (min/km), cadencia (rpm), pendientes, RIR.
- **Resalta** cualquier mención a gel, avituallamiento o ingesta en la descripción (p. ej. "5' Z1 con gel").
- Aclara cosas ambiguas del icono (p. ej. "Caminata" puede ser cinta, no montaña).
- No des pautas nutricionales: eso es cosa de Rubén. Limítate a los hechos del entreno.

## 4. Maquetar el PDF (HTML → Chromium)
Escribe `plan.html` en español, A4 (`@page { size: A4; margin: 12mm 13mm; }`), fuente Helvetica/Arial, color de acento #f4425f. Estructura:
1. **Cabecera**: "Planificación de entrenamiento · Semana N", rango de fechas, y una fila con deportista, entrenador, momento de temporada y objetivo.
2. **KPIs** (5 tarjetas): volumen total, nº de sesiones, carrera, bici + cinta/caminata, fuerza/core (suma los minutos y compruébalo).
3. **Nota** sobre qué significan los puntitos, más cualquier aclaración.
4. **Tabla resumen**: Día | Sesión (etiqueta de color por deporte: carrera #e8590c, ciclismo #1971c2, caminata #2f9e44, fuerza/core #6741d9, natación #0c8599) | Duración | Carga (5 puntos, rellenos según el nivel) | Intensidad/zonas.
5. **Minutos por día**: barras horizontales apiladas por deporte, escaladas al día con más minutos, con leyenda.
6. **Nota "Para tener en cuenta"**: geles pautados y el día de más volumen o intensidad.
7. Salto de página → **Detalle de cada sesión**: una tarjeta por día (`break-inside: avoid`) con viñetas de la estructura completa; para el gimnasio, los circuitos con peso ×reps (RIR).
8. Pie: fuente de los datos y glosario (Z, RIR, rpm).

Renderizado (desde `"$SCRATCH"` con el entorno virtual):
```bash
cd "$SCRATCH" && /Users/pablo/.claude-work/skills/train2go-pdf-nutricionista/.venv/bin/python3 - <<'EOF'
from playwright.sync_api import sync_playwright
import os
salida = os.path.expanduser('~/Documents/Claude/Entrenos')
os.makedirs(salida, exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page()
    pg.goto('file://' + os.path.abspath('plan.html'))
    pg.pdf(path=os.path.join(salida, 'Entrenos_Pablo_semanaN_DDmmm-DDmmm.pdf'), format='A4', print_background=True, prefer_css_page_size=True)
    b.close()
EOF
```
Previsualiza con `pdftoppm -r 90 -png` y lee las páginas: sin páginas casi vacías y sin textos cortados. Normalmente ocupa 3 páginas (resumen + 2 de detalle).

## 5. Entrega y limpieza
- Borra `cookies.txt`, los JSON y HTML crudos del scratchpad; al acabar, borra el directorio temporal y todos sus intermedios. Conserva el PDF final en `~/Documents/Claude/Entrenos/`.
- Comunica la ruta absoluta del PDF generado y ofrece abrirlo con `open <ruta_absoluta_del_PDF>`.
- Recuerda a Pablo que cierre sesión en Train2Go para invalidar las cookies que ha pegado.
- Resumen en 2–3 frases: volumen total, días clave y geles pautados.

## 6. Si luego pasa el plan de Rubén
Crúzalo con los entrenos y señala discrepancias (sesiones mal etiquetadas, geles ya pautados por Dani, orden de las sesiones, días marcados como descanso que tienen entreno). Ofrece un mensaje de WhatsApp breve para el grupo.
