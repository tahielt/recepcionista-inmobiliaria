-- Corre una sola vez, cuando el volumen de Postgres está vacío.
-- Una base por servicio; el esquema de "inmo" lo aplica la instalación (idempotente).
CREATE DATABASE n8n;
CREATE DATABASE chatwoot;
CREATE DATABASE evolution;
CREATE DATABASE inmo;
