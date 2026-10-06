-- schema.sql — Inmobiliaria Demo (FICTICIA, datos sintéticos de Bariloche)
-- Correr en la misma Postgres del stack (DB n8n) o en Supabase.
-- Nada de esto es real: propiedades, precios, leads y teléfonos son inventados.

-- Catálogo de propiedades (fuente de verdad: el agente NUNCA inventa fuera de acá)
CREATE TABLE IF NOT EXISTS propiedades (
  id             SERIAL PRIMARY KEY,
  codigo         TEXT UNIQUE NOT NULL,            -- p. ej. LCB-001
  titulo         TEXT NOT NULL,
  operacion      TEXT NOT NULL CHECK (operacion IN ('venta','alquiler')),
  tipo           TEXT NOT NULL,                   -- departamento | casa | cabaña | terreno
  zona           TEXT NOT NULL,                   -- barrio/zona de Bariloche
  ambientes      INT  NOT NULL DEFAULT 0,
  dormitorios    INT  NOT NULL DEFAULT 0,
  m2_cubiertos   INT  NOT NULL DEFAULT 0,
  precio_usd     INT  NOT NULL,
  unidad_precio  TEXT NOT NULL CHECK (unidad_precio IN ('venta_total','alquiler_mensual')),
  expensas_usd   INT,
  direccion_aprox TEXT,
  descripcion    TEXT,
  url_ficha      TEXT NOT NULL,                   -- link sintético a la ficha
  destacada      BOOLEAN NOT NULL DEFAULT FALSE,
  activa         BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_prop_filtro
  ON propiedades (operacion, zona, dormitorios, precio_usd) WHERE activa;

-- Estado de precalificación por lead (sesión = número/identificador de WhatsApp sintético)
CREATE TABLE IF NOT EXISTS leads (
  session_id     TEXT PRIMARY KEY,               -- p. ej. "wa:5492944000001" (sintético)
  nombre         TEXT,
  operacion      TEXT,                            -- compra | alquiler
  zona           TEXT,
  presupuesto_usd INT,
  ambientes      INT,
  forma_pago     TEXT,                            -- contado | crédito | permuta | ...
  urgencia       TEXT,                            -- alta | media | baja
  ia_activa      BOOLEAN NOT NULL DEFAULT TRUE,   -- patrón 2: pausa humana
  derivado       BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Bitácora de derivaciones / bloqueos del verificador (para la nota privada al equipo)
CREATE TABLE IF NOT EXISTS eventos_equipo (
  id          SERIAL PRIMARY KEY,
  session_id  TEXT NOT NULL,
  tipo        TEXT NOT NULL,                      -- derivacion | hard_fail | pausa_humana
  detalle     TEXT,
  creado_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
