#!/bin/sh
# Backup de Postgres: un archivo por base (formato custom de pg_dump, comprimido) y borra los de más de N días.
# Uso (desde cualquier carpeta):  scripts/backup.sh
# Cron diario a las 03:30:  30 3 * * * /opt/recepcionista/scripts/backup.sh >> /opt/recepcionista/backups/backup.log 2>&1
# Variables opcionales (en .env o en el entorno):
#   BACKUP_DIR=backups   BACKUP_DIAS=14   BACKUP_RCLONE=r2:mi-bucket/recepcionista  (copia afuera del VPS con rclone)
set -eu
cd "$(dirname "$0")/.."
[ -f .env ] && . ./.env
DIR="${BACKUP_DIR:-backups}"
FECHA=$(date +%F_%H%M)
mkdir -p "$DIR"

for base in inmo chatwoot n8n evolution; do
  docker compose exec -T postgres sh -c "pg_dump -U \"\$POSTGRES_USER\" -Fc $base" > "$DIR/$base-$FECHA.dump.tmp"
  mv "$DIR/$base-$FECHA.dump.tmp" "$DIR/$base-$FECHA.dump"
done
find "$DIR" -name '*.dump' -mtime +"${BACKUP_DIAS:-14}" -delete

if [ -n "${BACKUP_RCLONE:-}" ]; then
  rclone copy "$DIR" "$BACKUP_RCLONE" --include "*-$FECHA.dump"
fi
echo "$(date '+%F %T') ✓ backup $FECHA: $(ls "$DIR"/*-"$FECHA".dump | wc -l) bases en $DIR$( [ -n "${BACKUP_RCLONE:-}" ] && echo " + $BACKUP_RCLONE")"
