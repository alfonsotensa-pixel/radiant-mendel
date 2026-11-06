-- Ajustes opcionales para la tabla existente public.egresos (ejecutar en el SQL Editor de Supabase)

-- 1) Habilitar Realtime para que el tablero se actualice al instante
--    (si ya está habilitado, Supabase avisará que la tabla ya es miembro de la publicación).
alter publication supabase_realtime add table public.egresos;

-- 2) Índice por fecha para acelerar las consultas por mes
create index if not exists egresos_fecha_idx on public.egresos (fecha);

-- 3) (Referencia) Política de solo lectura para la clave publicable.
--    El tablero ya puede leer la tabla, así que esta política parece existir; revísala en
--    Authentication → Policies si quieres limitar quién puede consultar los egresos.
-- create policy "dashboard_read" on public.egresos for select to anon using (true);
