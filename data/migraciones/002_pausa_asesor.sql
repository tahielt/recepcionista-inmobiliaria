-- 002 · Pausa automática cuando escribe un asesor, y reactivación sola después de X horas.
-- Idempotente.
-- horas_reactivacion: horas sin actividad del asesor tras las que la IA vuelve a atender (0 = solo con /ia on).
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS horas_reactivacion INT NOT NULL DEFAULT 12;
-- Momento del último mensaje del asesor (o de la derivación) con la IA en pausa. Desde ahí corren las horas.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS actividad_asesor_at TIMESTAMPTZ;
