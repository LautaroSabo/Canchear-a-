# Abono de los clubes: cobro automático y suspensión

Cada club paga un abono mensual a la plataforma (`ABONO_MENSUAL`). Hay tres formas de que
quede registrado:

1. **Pago automático con Mercado Pago** (lo activa el dueño del club desde *Mi cuenta*): una
   suscripción de MP en **tu** cuenta, que debita todos los meses. Cada cobro aprobado
   extiende el abono un mes, solo.
2. **A mano**: el club te paga por transferencia y vos registrás el pago en *Plataforma*.
3. **Prueba gratis** al aprobar un club (`DIAS_PRUEBA`, 15 por defecto).

Si prendés la suspensión automática (`SUSPENSION_AUTOMATICA=1` en el worker) y el abono
queda vencido más de `DIAS_GRACIA_ABONO` días (5 por defecto), el worker **suspende el club
solo**: su página se sigue viendo pero no toma reservas, y el panel le
avisa por qué. Cuando entra un pago (automático o a mano), **se reactiva solo**. Una
suspensión que hiciste vos a mano no se levanta con un pago.

## Activar el cobro automático

Necesitás una cuenta de Mercado Pago **tuya** (la que recibe los abonos), distinta de las
de los clubes.

1. Entrá a **mercadopago.com.ar/developers** con esa cuenta → **Tus integraciones** →
   **Crear aplicación** (nombre: `Canchería abonos`; producto: *Suscripciones*).
2. En la aplicación, **Credenciales de producción** → copiá el **Access Token**
   (empieza con `APP_USR-`).
3. **Webhooks** → **Configurar notificaciones** → modo **Productivo**:
   - URL: `https://TU-WEB.up.railway.app/api/webhooks/mercadopago-abono`
     (con dominio propio para la API: `https://api.tudominio.com/webhooks/mercadopago-abono`).
   - Eventos: **Planes y suscripciones** (los dos: suscripciones y pagos de suscripciones).
   - Guardá y copiá la **Clave secreta** que te muestra.
4. En Railway, servicio **api** → Variables:
   ```
   MP_ABONO_ACCESS_TOKEN=APP_USR-…
   MP_ABONO_WEBHOOK_SECRET=…la clave secreta…
   ABONO_MENSUAL=25000            # en pesos
   ```
5. Probalo con un club tuyo: *Mi cuenta* → **Pagar automáticamente con Mercado Pago** → en
   MP autorizás con una tarjeta. Al volver, en unos segundos tiene que decir **"Se paga
   solo"**. El primer débito es al día siguiente de los días que el club ya tenía pagos (o
   en unos minutos, si estaba vencido); cuando se acredite, *Plataforma* muestra el pago
   y la nueva fecha de vencimiento.

Sin `MP_ABONO_ACCESS_TOKEN` el botón no aparece y todo sigue como antes (pago a mano).

## Suspensión automática

En el servicio **worker**:

```
SUSPENSION_AUTOMATICA=1      # prenderla (por defecto está apagada)
DIAS_GRACIA_ABONO=5          # días después del vencimiento hasta suspender
```

Antes de prenderla, mirá en *Plataforma* el vencimiento de cada club: los que ya estén
vencidos hace más de los días de gracia se suspenden en la primera revisión.

Revisa cada 6 horas. Solo toca clubes que tienen fecha de abono (los aprobados con prueba
o con algún pago registrado). Para un club que no querés que pague (el tuyo de prueba, un
amigo), registrale un pago con muchos meses en *Plataforma*.
