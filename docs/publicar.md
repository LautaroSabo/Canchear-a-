# Publicar Canchería

Guía para dejar la app en internet y sumar clubes. Está pensada para **Railway**, que
corre los cuatro servicios en un mismo proyecto: la base Postgres, la API, el worker y
la web. Cada servicio ya tiene su archivo `railway.json` en el repo.

## Lo que necesitás antes

| Qué | Para qué | Costo aproximado |
|---|---|---|
| Cuenta en [railway.com](https://railway.com), con login de GitHub | Correr la app | Plan Hobby: unos US$5 por mes más el uso. Para pocos clubes alcanza |
| Un dominio, por ejemplo `cancheria.com.ar`, en [NIC Argentina](https://nic.ar) | La dirección de la app | Pago anual. **Hace falta**: la sesión del panel exige que la web y la API compartan dominio |
| Acceso al dominio para cargar registros DNS | Apuntar el dominio a Railway | — |
| *(Opcional)* WhatsApp Cloud API de Meta | Mandar confirmaciones y recordatorios | Ver [whatsapp.md](whatsapp.md). La app funciona sin esto |

Mercado Pago no se configura acá: cada club conecta su propia cuenta desde el panel.

## 1. Crear el proyecto y la base

1. En Railway: **New Project → Deploy from GitHub repo** y elegí este repositorio.
   Railway crea un primer servicio: después lo convertís en la API (paso 2).
2. En el proyecto: **+ Create → Database → PostgreSQL**.

## 2. Los tres servicios

Creá tres servicios desde el mismo repositorio (**+ Create → GitHub Repo**) y en cada uno
andá a **Settings** y completá:

| Servicio | Config file path (*Settings → Config as code*) | Dominio |
|---|---|---|
| `api` | `apps/api/railway.json` | `api.tudominio.com.ar` |
| `worker` | `apps/worker/railway.json` | — (no se publica) |
| `web` | `apps/web/railway.json` | `tudominio.com.ar` |

El *root directory* queda vacío en los tres: se instala todo el monorepo y cada archivo
dice qué arrancar. La API corre las migraciones sola antes de cada despliegue
(`pnpm db:migrate`).

**Comprobantes de transferencia:** en el servicio `api`, *+ Volume*, montado en `/data`.
Sin el volumen, los comprobantes se pierden en cada despliegue.

## 3. Variables

Generá la clave de cifrado una sola vez y guardala en un lugar seguro. Con esa clave se
guardan cifradas las credenciales de Mercado Pago de los clubes; si se pierde, cada club
tiene que volver a conectar su cuenta.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

**api** (*Variables*):

```
DATABASE_URL=${{Postgres.DATABASE_URL}}
CLAVE_CREDENCIALES=<la clave generada>
URL_WEB=https://tudominio.com.ar
URL_API=https://api.tudominio.com.ar
WEB_ORIGIN=https://tudominio.com.ar
DIR_COMPROBANTES=/data/comprobantes
```

**worker**:

```
DATABASE_URL=${{Postgres.DATABASE_URL}}
CLAVE_CREDENCIALES=<la misma clave>
URL_WEB=https://tudominio.com.ar
# Cuando tengas WhatsApp:
# WHATSAPP_TOKEN=...
# WHATSAPP_PHONE_NUMBER_ID=...
```

**web**:

```
NEXT_PUBLIC_API_URL=https://api.tudominio.com.ar
# Opcional: un club de muestra para el botón de la portada.
# NEXT_PUBLIC_CLUB_EJEMPLO=el-slug-de-un-club
```

`NEXT_PUBLIC_API_URL` queda fija en la web al compilarla: si la cambiás, volvé a
desplegar el servicio `web`.

No definas `NODE_ENV`. Con `NODE_ENV=production` la instalación saltea dependencias que
hacen falta para compilar, y el worker no arranca sin WhatsApp. La cookie del panel igual
sale segura, porque `URL_API` empieza con `https://`.

## 4. Dominio

1. En los servicios `web` y `api`: *Settings → Networking → Custom Domain*. Cargá
   `tudominio.com.ar` en la web y `api.tudominio.com.ar` en la API.
2. Railway te muestra un registro `CNAME` para cada uno: cargalos en el DNS de tu dominio.
   El certificado HTTPS se genera solo.
3. Probá `https://api.tudominio.com.ar/health` y `https://tudominio.com.ar`.

## 5. Tu usuario de administrador

Una sola vez, desde tu compu y con la base de Railway. En el servicio Postgres, *Connect*,
copiá la **URL pública** de conexión y en PowerShell, dentro de la carpeta del proyecto:

```powershell
$env:DATABASE_URL="postgresql://...la url pública..."
pnpm superadmin vos@tumail.com "Tu nombre"
```

En Linux o Mac va `DATABASE_URL="..." pnpm superadmin ...`. Si el email no tenía cuenta,
el comando la crea y muestra la contraseña **una sola vez**. Con ese usuario entrás a
`https://tudominio.com.ar/panel` y vas a **Administrar plataforma**
(`/panel/plataforma`).

## 6. Clubes nuevos y abono

**Los clubes se registran solos** en `https://tudominio.com.ar/registrar`, el botón
"Registrá tu club" de la portada. Al registrarse:

1. El club queda **por aprobar**. El dueño entra directo a su panel y puede cargar canchas,
   horarios, tarifas, la seña, su Mercado Pago y el alias. Su página
   (`tudominio.com.ar/su-club`) ya se ve, pero avisa que todavía no toma reservas online.
2. Vos lo ves en **Administrar plataforma → Por aprobar**, con el email y el WhatsApp del
   dueño. Lo contactás, arreglás el abono y tocás **Aprobar**, con los días de prueba
   gratis que quieras. Desde ese momento su página toma reservas.
3. Cuando te paga, **Registrar pago**: elegís los meses y el monto. La cobertura se
   extiende desde el último día pago.
4. En **Abono por cobrar** aparecen los clubes vencidos o que vencen en los próximos 5
   días. Al club le aparece el mismo aviso en su panel, con el precio y cómo pagarte.
   Si no paga, **Suspender**: su página deja de tomar reservas (los turnos ya tomados se
   mantienen) hasta que lo **Reactivás**.

Para que cada club vea cuánto y cómo pagarte, en la **api** agregá:

```
ABONO_MENSUAL=25000
ABONO_COMO_PAGAR=Transferí al alias tu.alias.abono y mandanos el comprobante por WhatsApp.
```

`ABONO_MENSUAL` va en pesos.

### Aviso por mail cuando se registra un club

En la **api** agregá `AVISOS_EMAIL` con tu Gmail y una de estas dos formas de mandarlo.

**Con Resend (recomendado en Railway).** Railway bloquea el envío por SMTP en el plan
Hobby, y Resend manda por HTTPS. Es gratis hasta 3.000 mails por mes.

1. Creá una cuenta en [resend.com](https://resend.com) **con el mismo Gmail** donde querés
   recibir los avisos.
2. En *API Keys → Create API Key*, con permiso *Sending access*, copiá la clave (`re_…`).
3. En la api:
   ```
   AVISOS_EMAIL=tu@gmail.com
   RESEND_API_KEY=re_...
   ```

Sin un dominio verificado en Resend, los mails salen de `onboarding@resend.dev` y solo
pueden ir al email de tu cuenta de Resend. Para un aviso a vos alcanza. Si después
verificás tu dominio, agregá `CORREO_REMITENTE=Canchería <avisos@tudominio.com.ar>`.

**Con Gmail directo (SMTP).** Anda en tu compu o en un hosting que permita SMTP (en
Railway, solo en el plan Pro).

1. En tu cuenta de Google activá la verificación en dos pasos.
2. Entrá a [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords),
   creá una contraseña de aplicación ("Canchería") y copiá los 16 caracteres.
3. En la api:
   ```
   AVISOS_EMAIL=tu@gmail.com
   SMTP_HOST=smtp.gmail.com
   SMTP_PUERTO=465
   SMTP_USUARIO=tu@gmail.com
   SMTP_CONTRASENA=xxxx xxxx xxxx xxxx
   ```

El mail trae el club, su página, el WhatsApp, el nombre y el email del dueño, y el link a
**Administrar plataforma**. Si el envío falla, el registro igual queda hecho: el club
aparece en *Por aprobar* y el error queda en los logs de la api.

**Alta manual (opcional):** si preferís crear vos un club, ya aprobado y con dueño:

```powershell
pnpm club:crear el-potrero "El Potrero" duenio@elpotrero.com "Nombre del dueño"
pnpm usuario:crear recepcion@elpotrero.com "Recepción" el-potrero RECEPCION
```

## 7. Mercado Pago de cada club

En **Configuración → Cobros**, el dueño:

1. Pega el *Access token de producción* de su aplicación de Mercado Pago (Checkout Pro).
2. Copia la **URL de notificaciones** que muestra el panel
   (`https://api.tudominio.com.ar/webhooks/mercadopago/<slug>`) en su aplicación de
   Mercado Pago, en *Webhooks*, con el evento *Pagos*.
3. Pega la **clave secreta** de webhooks que le da Mercado Pago.

Para probar sin plata real, puede usar primero las credenciales `TEST-…` y las tarjetas
de prueba de Mercado Pago.

## Actualizar

Cada push a la rama principal vuelve a desplegar solo los servicios afectados (por los
`watchPatterns` de cada `railway.json`). Las migraciones se aplican antes de que la API
nueva reciba tráfico.

## Si algo falla

- **La web muestra "La web no pudo conectarse con la API":** revisá `NEXT_PUBLIC_API_URL`
  en la web (y volvé a desplegarla) y que `/health` de la API responda.
- **El panel no mantiene la sesión:** la web y la API tienen que estar en el mismo
  dominio (`tudominio.com.ar` y `api.tudominio.com.ar`), no en dos subdominios de
  `up.railway.app`.
- **Error de CORS en la consola del navegador:** `WEB_ORIGIN` de la API tiene que ser
  exactamente la URL de la web, con `https://` y sin `/` al final.
- **Los pagos de Mercado Pago tardan en confirmarse:** revisá la URL de notificaciones en
  Mercado Pago. Igual se confirman: el worker consulta a Mercado Pago antes de liberar
  el turno.
