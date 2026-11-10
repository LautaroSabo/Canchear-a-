# Aviso de errores (Sentry)

Si algo falla en producción (una página que no carga, la API que responde "Error interno", una
tarea del worker que no anda), te llega un mail con el error y dónde pasó, en vez de enterarte
cuando te llama un club.

**Qué se avisa:** solo errores inesperados. Un turno ocupado, una contraseña mal escrita o un
dato inválido no son errores: no se avisan. El mismo error se avisa como mucho una vez cada 10
minutos.

**Qué no se manda:** ni nombres, ni teléfonos, ni emails, ni el cuerpo de las requests, ni
cookies, ni IPs, ni los códigos de los comprobantes. Solo el error, el servicio (`api`,
`worker` o `web`) y la ruta (por ejemplo `/public/reservas/:codigo`, sin el código).

## Activarlo (10 minutos, gratis)

1. Creá una cuenta en **sentry.io** (el plan *Developer* es gratis: 5.000 errores por mes).
2. **Create Project** → plataforma **Node.js** → nombre `cancheria` → *Create Project*.
3. Copiá el **DSN** que te muestra (empieza con `https://` y termina en `.ingest…sentry.io/…`).
   Si lo perdiste: *Settings → Projects → cancheria → Client Keys (DSN)*.
4. En Railway, cargá la variable en los **tres** servicios (`api`, `worker` y `web`):
   ```
   SENTRY_DSN=https://…tu DSN…
   ```
   Cada servicio se redespliega solo al guardar la variable.
5. Probalo: en Railway, servicio `api` → consola, y corré
   ```
   export PATH="/mise/shims:$PATH"
   pnpm aviso:prueba
   ```
   En un minuto aparece en Sentry, en **Issues**, y te llega el mail.

Por defecto Sentry manda un mail la primera vez que aparece cada error nuevo. Se cambia en
*Alerts*. Desde la app del celular de Sentry también te llegan las notificaciones.

Sin `SENTRY_DSN` todo sigue igual: los errores quedan solo en los logs de Railway.
