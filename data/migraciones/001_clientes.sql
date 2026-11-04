-- 001 · Multi-cliente: una instalación, N inmobiliarias.
-- Idempotente y sin perder datos: si ya había propiedades o leads, quedan en el cliente 1
-- ("Cliente inicial", sin inbox). Para que vuelva a atender: UPDATE clientes SET nombre = '…', inbox_id = N WHERE id = 1;
BEGIN;

CREATE TABLE IF NOT EXISTS clientes (
  id              SERIAL PRIMARY KEY,
  nombre          TEXT NOT NULL,
  inbox_id        INT UNIQUE,                         -- inbox de Chatwoot (WhatsApp de la inmobiliaria)
  umbral_usd      INT NOT NULL DEFAULT 400000,        -- presupuesto desde el que deriva a un asesor
  telefono_asesor TEXT,                               -- el bot lo puede pasar al derivar
  prompt_extra    TEXT NOT NULL DEFAULT '',           -- tono, horarios y datos de la inmobiliaria
  activo          BOOLEAN NOT NULL DEFAULT TRUE
);

-- Datos previos al multi-cliente → cliente 1.
INSERT INTO clientes (id, nombre)
SELECT 1, 'Cliente inicial'
WHERE NOT EXISTS (SELECT 1 FROM clientes)
  AND (EXISTS (SELECT 1 FROM propiedades) OR EXISTS (SELECT 1 FROM leads) OR EXISTS (SELECT 1 FROM eventos_equipo));
DO $$ BEGIN
  PERFORM setval(pg_get_serial_sequence('clientes', 'id'), GREATEST((SELECT max(id) FROM clientes), 1), (SELECT count(*) > 0 FROM clientes));
END $$;

ALTER TABLE propiedades    ADD COLUMN IF NOT EXISTS cliente_id INT REFERENCES clientes(id);
ALTER TABLE leads          ADD COLUMN IF NOT EXISTS cliente_id INT REFERENCES clientes(id);
ALTER TABLE eventos_equipo ADD COLUMN IF NOT EXISTS cliente_id INT REFERENCES clientes(id);
UPDATE propiedades    SET cliente_id = 1 WHERE cliente_id IS NULL;
UPDATE leads          SET cliente_id = 1 WHERE cliente_id IS NULL;
UPDATE eventos_equipo SET cliente_id = 1 WHERE cliente_id IS NULL;
ALTER TABLE propiedades    ALTER COLUMN cliente_id SET NOT NULL;
ALTER TABLE leads          ALTER COLUMN cliente_id SET NOT NULL;
ALTER TABLE eventos_equipo ALTER COLUMN cliente_id SET NOT NULL;

-- El código de una propiedad es único dentro de cada inmobiliaria, no en toda la base.
ALTER TABLE propiedades DROP CONSTRAINT IF EXISTS propiedades_codigo_key;
DO $$ BEGIN
  ALTER TABLE propiedades ADD CONSTRAINT propiedades_cliente_codigo_key UNIQUE (cliente_id, codigo);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;

-- Un mismo WhatsApp puede escribirle a dos inmobiliarias: el lead es por cliente.
DO $$ BEGIN
  IF (SELECT count(*) FROM information_schema.key_column_usage WHERE constraint_name = 'leads_pkey') = 1 THEN
    ALTER TABLE leads DROP CONSTRAINT leads_pkey;
    ALTER TABLE leads ADD CONSTRAINT leads_pkey PRIMARY KEY (cliente_id, session_id);
  END IF;
END $$;

DROP INDEX IF EXISTS idx_prop_filtro;
CREATE INDEX IF NOT EXISTS idx_prop_cliente_filtro
  ON propiedades (cliente_id, operacion, zona, dormitorios, precio_usd) WHERE activa;

COMMIT;
