#!/usr/bin/env bash
# Lanza N reservas simultáneas por el mismo horario y verifica que gane solo una.
# Uso: DATABASE_URL=postgres://... ./db/tests/concurrencia.sh [N]
# Requiere una base vacía con db/schema.sql aplicado.
set -euo pipefail
N=${1:-50}
P=(psql "$DATABASE_URL" -qtAX -v ON_ERROR_STOP=1)
CLUB=00000000-0000-0000-0000-000000000001
CANCHA=00000000-0000-0000-0000-0000000000c1

"${P[@]}" <<SQL
INSERT INTO clubs (id, slug, nombre) VALUES ('$CLUB', 'test-concurrencia', 'Test');
INSERT INTO canchas (id, club_id, nombre, jugadores_por_lado) VALUES ('$CANCHA', '$CLUB', 'Cancha 1', 5);
INSERT INTO clientes (club_id, nombre, telefono_e164)
  SELECT '$CLUB', 'Jugador ' || g, '+54911' || lpad(g::text, 8, '0') FROM generate_series(1, $N) g;
SQL

reservar() {
  "${P[@]}" -v tel="+54911$(printf %08d "$1")" <<SQL
BEGIN;
UPDATE turnos SET estado = 'EXPIRADO', expira_en = NULL
 WHERE cancha_id = '$CANCHA' AND estado = 'PRE_RESERVADO' AND expira_en <= now()
   AND rango && tstzrange('2030-01-05 20:00-03', '2030-01-05 21:00-03', '[)');
INSERT INTO turnos (club_id, cancha_id, cliente_id, inicio, fin, estado, origen, expira_en)
SELECT club_id, '$CANCHA', id, '2030-01-05 20:00-03', '2030-01-05 21:00-03',
       'PRE_RESERVADO', 'WEB', now() + interval '10 min'
  FROM clientes WHERE telefono_e164 = :'tel';
COMMIT;
SQL
}

TMP=$(mktemp -d)
for i in $(seq 1 "$N"); do
  ( reservar "$i" >/dev/null 2>"$TMP/err_$i" && echo OK || echo FAIL ) >"$TMP/res_$i" &
done
wait

OK=$(cat "$TMP"/res_* | grep -c OK || true)
CONFLICTOS=$(cat "$TMP"/err_* | grep -c turnos_sin_solapamiento || true)
VIVOS=$("${P[@]}" -c "SELECT count(*) FROM turnos WHERE cancha_id = '$CANCHA' AND estado = 'PRE_RESERVADO'")
rm -rf "$TMP"

echo "éxitos=$OK conflictos=$CONFLICTOS turnos_vivos=$VIVOS"
[[ $OK -eq 1 && $CONFLICTOS -eq $((N - 1)) && $VIVOS -eq 1 ]] && echo PASS || { echo FAIL; exit 1; }
