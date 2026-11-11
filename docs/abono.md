# Abono de los clubes: cobro automático y suspensión

## Cuánto paga cada club

El precio sale de **cuántas canchas activas** tiene el club, según los planes que editás en
*Plataforma → Planes del abono* (de entrada: **Chico** 1–3 canchas $39.900, **Mediano** 4–6
$59.900, **Grande** 7 o más $79.900). Si un club suma canchas y pasa de plan, paga el nuevo
precio desde el mes siguiente. Cuando ajustes por inflación, cambiás los precios ahí.

**Precio especial** (botón *Precio especial* en cada club): un **% de descuento** sobre su
plan o un **precio fijo**, con fecha de vencimiento opcional y un motivo. Ejemplo: precio
fundador, −40% hasta dentro de 12 meses. Al vencer, vuelve solo al precio del plan.

**Pago anual**: al registrar un pago de 12 meses, el monto sugerido es el de 10 (2 gratis).

Si el club paga con débito automático, el worker actualiza el monto de la suscripción en
Mercado Pago cuando cambia su precio (necesita `MP_ABONO_ACCESS_TOKEN` también en el
servicio `worker`).

`ABONO_MENSUAL` ya no se usa.

## Cómo queda registrado el pago

Hay tres formas:

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
4. En Railway, servicios **api** y **worker** → Variables (el token en los dos; el secreto, en api):
   ```
   MP_ABONO_ACCESS_TOKEN=APP_USR-…
   MP_ABONO_WEBHOOK_SECRET=…la clave secreta…
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
