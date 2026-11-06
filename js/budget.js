/**
 * Presupuesto operativo mensual de Elemental Club.
 * Fuente: Google Drive → Resultados mensuales → "presupuesto mensual elemental.pdf"
 *         (PRESUPUESTO OPERATIVO CALIBRADO 2026, calibrado con registros Ene–Sep 2026).
 *
 * `pace` define cómo se espera que se consuma el presupuesto durante el mes:
 *   - "linear": gasto distribuido a lo largo del mes (semanal / diario).
 *   - "fixed":  pago único en el mes (p. ej. renta). Solo alerta si se rebasa el monto.
 *
 * `match` lista las categorías (tal como se capturan en Supabase) que se suman
 * a cada rubro del presupuesto. La comparación ignora mayúsculas y acentos.
 */
window.BUDGET = {
  source: "Drive · Elemental / Resultados mensuales / presupuesto mensual elemental.pdf",
  title: "Presupuesto Operativo Calibrado 2026",
  monthlyTotal: 553306.73,
  categories: [
    {
      id: "nomina",
      name: "Nómina y Dirección",
      budget: 307178.33,
      pace: "linear",
      match: ["nomina", "nómina", "sueldos", "direccion"],
      concepts: [
        ["Nómina Directiva", 60000.0],
        ["Nómina Coaches (con 10% holgura)", 145145.0],
        ["Nómina Recepción", 34666.67],
        ["Nómina Seguridad", 28600.0],
        ["Nómina Limpieza", 22100.0],
        ["Nómina Mantenimiento", 8000.0],
        ["Nómina Marketing / Contenido", 8666.67],
      ],
    },
    {
      id: "renta",
      name: "Renta de Inmueble",
      budget: 150000.0,
      pace: "fixed",
      match: ["renta", "arrendamiento"],
      concepts: [["Renta de Inmueble", 150000.0]],
    },
    {
      id: "servicios",
      name: "Servicios Básicos y Fijos",
      budget: 33995.07,
      pace: "linear",
      match: ["servicios", "servicios basicos"],
      concepts: [
        ["Gas", 10833.33],
        ["Luz (CFE)", 8000.0],
        ["Pipa de Agua", 6500.0],
        ["Recolección de Basura", 3403.4],
        ["Internet y Conectividad (Starlink)", 2000.0],
        ["Monitoreo de Alarma", 300.0],
        ["Contabilidad Externa", 2333.33],
        ["Seguro de Responsabilidad Civil", 625.0],
      ],
    },
    {
      id: "consumibles",
      name: "Consumibles y Tienda",
      budget: 22283.33,
      pace: "linear",
      match: ["consumibles", "tienda"],
      concepts: [
        ["Bebidas y Tienda (Pepsi, isotónicos)", 11483.33],
        ["Insumos de Limpieza", 4000.0],
        ["Barritas y Proteínas", 3500.0],
        ["Magnesia, Pilas y Varios Gym", 2000.0],
        ["Garrafones de Agua", 1300.0],
      ],
    },
    {
      id: "digitales",
      name: "Servicios Digitales y Eventos",
      budget: 18350.0,
      pace: "linear",
      match: ["marketing/ventas", "marketing", "ventas", "eventos", "software"],
      concepts: [
        ["App Trainingym", 9500.0],
        ["Pauta publicitaria", 3500.0],
        ["Software / IA (ChatGPT, Meta, N8N)", 1600.0],
        ["Eventos y Dinámicas Socios", 3750.0],
      ],
    },
    {
      id: "comisiones",
      name: "Comisiones de Terminales",
      budget: 11000.0,
      pace: "linear",
      match: ["comisiones", "comision"],
      concepts: [["Comisiones Terminales y Bancos", 11000.0]],
    },
    {
      id: "mantenimiento",
      name: "Mantenimiento y Jardinería",
      budget: 10500.0,
      pace: "linear",
      match: ["mantenimiento", "jardineria"],
      concepts: [
        ["Materiales Mantenimiento Corriente", 6000.0],
        ["Jardinería y Áreas Verdes", 4500.0],
      ],
    },
    {
      id: "general",
      name: "Gastos Generales (sin presupuesto)",
      budget: 0,
      pace: "linear",
      match: ["general", "otros", "otro"],
      concepts: [],
    },
  ],

  /** Salidas que NO forman parte del presupuesto operativo (se muestran aparte). */
  nonOperating: [
    { id: "inversion", name: "Inversión (CapEx)", match: ["inversion"] },
    { id: "utilidades", name: "Utilidades / Retiros", match: ["utilidades", "retiros"] },
    { id: "prestamo", name: "Préstamos", match: ["prestamo", "prestamos"] },
  ],
};
