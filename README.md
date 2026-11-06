# Elemental Club · Monitoreo de Gasto Mensual

Página de publicación de resultados que compara el **presupuesto operativo mensual**
(Drive → `Elemental / Resultados mensuales / presupuesto mensual elemental.pdf`)
contra los **gastos del mes en curso** registrados en **Supabase**, con semáforo de alertas
y actualización en tiempo real.

## Uso rápido

1. Abre `index.html` en el navegador (no requiere build ni servidor).
   Sin credenciales arranca en **modo demo** con datos simulados.
2. Para datos reales, edita `js/config.js`:
   - `SUPABASE_URL` y `SUPABASE_ANON_KEY` (Supabase → Project Settings → API).
   - `table` y `columns` si tu tabla no se llama `gastos` o usa otros nombres de columna.
3. Si aún no tienes la tabla o Realtime activo, ejecuta `supabase/schema.sql` en el SQL Editor.

## Archivos

| Archivo | Contenido |
|---|---|
| `js/budget.js` | Presupuesto por categoría y concepto (extraído del PDF de Drive) y mapeo de categorías de Supabase → rubro. |
| `js/config.js` | Conexión a Supabase, columnas y umbrales del semáforo. |
| `js/app.js` | Cálculos, semáforo, alertas, gráficas, tiempo real y modo demo. |
| `supabase/schema.sql` | Tabla esperada, política RLS de solo lectura y publicación Realtime. |

## Lógica del semáforo

- **Avance esperado** = presupuesto × (día actual / días del mes). La renta (`pace: "fixed"`) se evalúa como pago único.
- **Proyección al cierre** = mezcla del ritmo real (`gastado / avance`) y del supuesto de que el resto del mes
  se gaste según presupuesto; el ritmo real pesa más conforme avanza el mes.
- 🟢 **En control**: proyección < 90 %.
- 🟡 **En riesgo**: proyección 90–105 %, o ≥ 85 % consumido con más de 7 días por delante.
- 🔴 **Excedido / Tendencia a exceder**: gasto ≥ 100 % o proyección ≥ 105 %.

Todos los umbrales se ajustan en `js/config.js → thresholds`.

## Comparar meses anteriores

El selector **Comparar mes** (arriba del título) abre por defecto el mes en curso y permite elegir
cualquiera de los últimos 24 meses (`HISTORY_MONTHS` en `js/app.js`). Un mes anterior se evalúa como
**cerrado**: gasto total vs. presupuesto, sobregiro o remanente final y semáforo de cierre.
Enlace directo: `index.html#mes=2026-10`.

## Actualizar el presupuesto

Cuando cambie el PDF en Drive, actualiza los montos en `js/budget.js`. Las categorías de Supabase
que no coincidan con ningún rubro se suman a "Gastos Generales" y se muestran como alerta para que las mapees.
