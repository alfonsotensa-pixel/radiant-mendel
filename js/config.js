/**
 * Configuración de conexión a Supabase y reglas del semáforo.
 *
 * Por seguridad, la URL y la clave de Supabase NO se guardan en el repositorio.
 * La primera vez que se abre la página se piden en pantalla y se guardan solo
 * en ese navegador (localStorage). Botón "Conexión" para cambiarlas u olvidarlas.
 * Sin conexión, el tablero funciona en MODO DEMO con datos simulados.
 */
window.APP_CONFIG = {
  // Dejar vacíos en el repositorio público.
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
  storageKey: "elemental.supabase",

  // Tabla y columnas donde se registran los gastos del mes.
  table: "egresos",
  columns: {
    date: "fecha",           // date
    amount: "monto",         // numeric (positivo)
    category: "categoria",   // text (Nomina, Servicios, consumibles, ...)
    concept: "titulo",       // text (descripción del gasto)
    wallet: "cartera",       // text (alfonso mercado, Caja chica, Resguardo, ...)
  },

  // Reglas del semáforo (proporción respecto al presupuesto mensual).
  thresholds: {
    // Proyección a fin de mes / presupuesto
    projectionAmber: 0.9,    // ≥ 90 % → amarillo (en riesgo)
    projectionRed: 1.05,     // ≥ 105 % → rojo (tendencia a exceder)
    // Gasto real acumulado / presupuesto
    spentAmber: 0.85,        // ≥ 85 % consumido con más de `minDaysLeft` días restantes → amarillo
    spentRed: 1.0,           // ≥ 100 % consumido → rojo (excedido)
    minDaysLeft: 7,
    // Días mínimos antes de dar peso al ritmo real en la proyección
    // (antes de eso se asume que el resto del mes sigue el presupuesto).
    minDaysForProjection: 3,
  },

  // Refresco de respaldo (ms) además de la suscripción en tiempo real.
  pollIntervalMs: 60000,
  currency: "MXN",
  locale: "es-MX",
};
