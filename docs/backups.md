# Copias de seguridad

Hay dos capas. Conviene tener las dos.

| | Qué copia | Dónde queda | Para qué sirve |
|---|---|---|---|
| **Backups de Railway** | La base y el volumen de comprobantes | En Railway, mismo proyecto | Volver atrás rápido después de un error (un borrado, una migración que salió mal) |
| **Copia diaria en GitHub** (workflow `Backup`) | La base | En GitHub, cifrada, 30 días | Si se pierde el proyecto de Railway, la cuenta o el volumen. Cada copia **se restaura en una base vacía para comprobar que sirve** |

> Los backups de Railway no te salvan si se borra el volumen o el proyecto: se borran con él. Por eso la copia en GitHub.

## 1. Backups de Railway

1. En Railway, entrá al servicio **Postgres** → pestaña **Backups**.
2. Elegí **Daily** (diario, se guardan 6 días). Si además querés más historia, sumá **Weekly**.
3. Hacé lo mismo en el servicio **api** (el volumen `/data` tiene los comprobantes de transferencia).

Si la pestaña no aparece o pide pasar a Pro, tu plan no los incluye: con la copia en GitHub
igual estás cubierto para la base (los comprobantes quedarían sin copia).

## 2. Copia diaria en GitHub

Corre todos los días a las 03:17 (hora de Argentina).

**a. Habilitar la conexión desde afuera a la base**

1. Railway → servicio **Postgres** → **Settings** → **Networking** → **TCP Proxy** → activalo (puerto 5432).
2. Botón **Connect** (arriba a la derecha) → pestaña **Public Network** → copiá la **Connection URL**.
   Tiene que verse como `postgresql://postgres:…@algo.proxy.rlwy.net:12345/railway`. Si tiene
   `${{…}}` adentro es la plantilla, no la dirección real: así no anda.

**b. Cargar dos secretos en GitHub**

En el repositorio → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:

| Nombre | Valor |
|---|---|
| `BACKUP_DATABASE_URL` | La `DATABASE_PUBLIC_URL` del paso anterior |
| `CLAVE_BACKUP` | Una clave larga inventada por vos (por ejemplo, 5 o 6 palabras al azar) |

> **Guardá `CLAVE_BACKUP` en otro lado** (un gestor de contraseñas, un papel). Las copias van
> cifradas con esa clave: sin ella no se pueden abrir, ni siquiera vos.

**c. Probarla una vez**

GitHub → **Actions** → **Backup** → **Run workflow**. En un par de minutos tiene que quedar en verde
y, abajo de todo, en **Artifacts**, un archivo `backup-AAAA-MM-DD.dump.gpg`. En el paso
*Copiar y probar* se ve cuántos clubs, turnos y pagos tenía la base y cuántos quedaron en la
copia restaurada.

Si falta algún secreto, el workflow termina en verde con un aviso y no copia nada.

## 3. Restaurar (y practicarlo una vez)

Conviene practicarlo una vez con calma, sobre una base nueva, para no hacerlo por primera vez
con el club llamando.

1. Bajá el artefacto desde GitHub (**Actions** → la corrida → **Artifacts**) y descomprimí el `.zip`:
   queda `backup-AAAA-MM-DD.dump.gpg`.
2. Necesitás `gpg` y las herramientas de Postgres (`pg_restore`) en tu compu, o usá la consola de Railway.
3. **Práctica:** creá en Railway un Postgres nuevo (*+ New → Database → PostgreSQL*), copiá su
   `DATABASE_PUBLIC_URL` y corré:

   ```bash
   scripts/restaurar-backup.sh backup-AAAA-MM-DD.dump.gpg "postgresql://…la URL de la base nueva…"
   ```

   Te pide la `CLAVE_BACKUP` y que confirmes. Después borrá ese Postgres de prueba.
4. **De verdad:** lo mismo, pero con la URL de la base de producción. Restaurar **reemplaza todo** lo
   que haya en esa base. Después reiniciá los servicios `api` y `worker`.
