#!/usr/bin/env bash
# Restaura una copia hecha por el workflow "Backup" (archivo .dump.gpg).
#   scripts/restaurar-backup.sh backup-2026-11-10.dump.gpg "postgres://usuario:clave@host:puerto/base"
# Pide la clave de la copia (el secreto CLAVE_BACKUP de GitHub). Restaurar BORRA lo que haya
# en la base de destino: probalo primero en una base nueva y recién después en producción.
set -euo pipefail

archivo="${1:?uso: restaurar-backup.sh archivo.dump.gpg URL_DE_LA_BASE}"
destino="${2:?falta la URL de la base de destino}"
dump="$(mktemp --suffix=.dump)"
trap 'rm -f "$dump"' EXIT

# Sin CLAVE_BACKUP en el entorno, gpg la pide.
if [ -n "${CLAVE_BACKUP:-}" ]; then
  gpg --batch --yes --pinentry-mode loopback --passphrase-fd 0 --decrypt --output "$dump" "$archivo" <<<"$CLAVE_BACKUP"
else
  gpg --yes --decrypt --output "$dump" "$archivo"
fi
if [ "${CONFIRMAR:-}" != "si" ]; then
  read -r -p "Esto reemplaza todo lo que hay en la base de destino. ¿Seguro? (escribí si) " ok
  [ "$ok" = "si" ] || { echo "Cancelado."; exit 1; }
fi
pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error --dbname="$destino" "$dump"
echo "✓ Restaurada. Reiniciá la API y el worker en Railway."
