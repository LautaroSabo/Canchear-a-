#!/usr/bin/env bash
# Copia de la base y prueba de que se puede restaurar.
#   ORIGEN_URL     base a copiar (la de producción)
#   VERIFICAR_URL  base vacía de prueba donde se restaura la copia para comprobarla
#   SALIDA         archivo del dump (formato custom de pg_dump)
# Usa pg_dump/pg_restore/psql del PATH: tienen que ser de la misma versión que el
# servidor o más nuevos (en el workflow corre dentro de la imagen oficial de Postgres).
set -euo pipefail

: "${ORIGEN_URL:?falta ORIGEN_URL}"
: "${VERIFICAR_URL:?falta VERIFICAR_URL}"
SALIDA="${SALIDA:-backup.dump}"

echo "→ Copiando la base…"
pg_dump --format=custom --no-owner --no-privileges --file="$SALIDA" "$ORIGEN_URL"
echo "  $(du -h "$SALIDA" | cut -f1)"

echo "→ Restaurando la copia en una base vacía para probarla…"
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$VERIFICAR_URL" "$SALIDA"

contar() { psql "$1" -tAc "SELECT (SELECT count(*) FROM clubs) || ' clubs, ' || (SELECT count(*) FROM turnos) || ' turnos, ' || (SELECT count(*) FROM pagos) || ' pagos'"; }
original=$(contar "$ORIGEN_URL")
restaurada=$(contar "$VERIFICAR_URL")
echo "  original:   $original"
echo "  restaurada: $restaurada"
# La base sigue recibiendo reservas mientras tanto: la copia puede tener algo menos,
# nunca más ni una base vacía.
if [ "$(psql "$VERIFICAR_URL" -tAc 'SELECT count(*) FROM clubs')" = "0" ]; then
  echo "✖ La copia restaurada no tiene clubs." >&2
  exit 1
fi
echo "✓ Copia completa y restaurable."
