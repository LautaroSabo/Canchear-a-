# WhatsApp: puesta en marcha

Canchería le manda al cliente 7 mensajes automáticos (turno confirmado, plazo vencido, cancelación, devolución, comprobante rechazado, lugar liberado de la lista de espera y turno fijo agendado). Fuera de una conversación abierta por el cliente, WhatsApp solo deja mandar **plantillas aprobadas por Meta**. Esta guía deja todo andando. Se hace una vez.

> Los menús de Meta cambian de nombre seguido. Si algo no aparece donde dice acá, buscalo por el nombre en el buscador de business.facebook.com o developers.facebook.com.

## Lo que vas a necesitar

- Una cuenta de **Meta Business** (business.facebook.com) a nombre del club o de la empresa.
- Un **número de teléfono** que **no** esté usando WhatsApp ni WhatsApp Business en ningún celular. Si ya está en uso, primero borrá la cuenta de WhatsApp de ese número. Un número que pasa a la API deja de funcionar en la app.
- Un **medio de pago** cargado en la cuenta (los mensajes de utilidad se cobran por mensaje).

## 1. Crear la app y la cuenta de WhatsApp

1. En **developers.facebook.com** → *Mis apps* → *Crear app* → tipo **Empresa** (Business), asociada a tu portfolio de Meta Business.
2. En la app, agregá el producto **WhatsApp**. Eso crea una **cuenta de WhatsApp Business (WABA)** y un número de prueba.
3. En *WhatsApp → Configuración de la API* (API Setup) anotá el **ID de la cuenta de WhatsApp Business**.

## 2. Agregar el número del club

1. En *WhatsApp → Configuración de la API* → **Agregar número de teléfono**: nombre visible (lo que ve el cliente, por ejemplo "La Canchita F5"), categoría y el número. Se verifica con un código por SMS o llamada.
2. El nombre visible pasa por una revisión de Meta; mientras tanto el número igual puede mandar mensajes.
3. Anotá el **ID del número de teléfono** (Phone number ID). No es el número: es un ID largo que aparece al lado.
4. Si te lo pide, registrá el número con un **PIN de 6 dígitos** (verificación en dos pasos) y guardalo.

## 3. Token permanente

El token que muestra la pantalla de prueba vence en 24 horas. Para producción:

1. En **business.facebook.com** → *Configuración del negocio* → *Usuarios* → **Usuarios del sistema** → *Agregar*: rol **Administrador**.
2. *Asignar activos*: la **app** (control total) y la **cuenta de WhatsApp** (control total).
3. **Generar token**: elegí la app, vencimiento **Nunca**, y los permisos `whatsapp_business_messaging` y `whatsapp_business_management`.
4. Copialo en el momento: Meta no lo vuelve a mostrar. Es una clave: no la mandes por chat ni la subas al repositorio.

## 4. Configurar el servidor

En el `.env` del servidor donde corre el worker:

```
WHATSAPP_TOKEN=<token del paso 3>
WHATSAPP_PHONE_NUMBER_ID=<ID del número, paso 2>
WHATSAPP_WABA_ID=<ID de la cuenta de WhatsApp, paso 1>
```

Sin `WHATSAPP_TOKEN` y `WHATSAPP_PHONE_NUMBER_ID` el worker no arranca en producción; en desarrollo los mensajes se imprimen en la consola.

## 5. Cargar las plantillas

```bash
pnpm whatsapp:plantillas crear    # crea en Meta las que falten
pnpm whatsapp:plantillas estado   # aprobada / en revisión / rechazada
```

Se crean con categoría **Utilidad** e idioma **Spanish (ARG) — `es_AR`**, con valores de ejemplo para la revisión. La aprobación suele tardar de minutos a unas horas (hasta 24 h). Repetí `estado` hasta que estén todas ✅. Correr `crear` de nuevo no duplica nada: solo crea las que faltan.

Si preferís cargarlas a mano en *WhatsApp Manager → Plantillas de mensajes*, `pnpm whatsapp:plantillas` (sin nada más) muestra cada una con su nombre, el texto con `{{1}}`, `{{2}}`… y los ejemplos. El **nombre tiene que ser exactamente ese**: el sistema manda cada mensaje con el nombre de su plantilla.

### Si Meta rechaza una

- `estado` muestra el motivo. Los textos ya pasan las reglas de formato de Meta (hay un test que lo verifica: ninguna empieza ni termina con una variable, no hay dos variables seguidas y la numeración va en orden), así que un rechazo suele ser por contenido o por categoría.
- Si Meta cambia una a **Marketing**, se puede seguir usando pero cuesta más. Revisala en WhatsApp Manager.
- Para corregir un texto: editalo en `packages/servicios/src/notificaciones/plantillas.ts` (el test avisa si rompe alguna regla), borrá la plantilla rechazada en WhatsApp Manager y volvé a correr `crear`.

## 6. Probar

Con las plantillas aprobadas, hacé una reserva desde la página del club con tu propio WhatsApp y pagá la seña (o cargá un turno manual desde el panel): tiene que llegarte "Turno confirmado". Si no llega, mirá **Mensajes** en el panel: cada mensaje muestra si salió y, si falló, el error de Meta (token vencido, número sin registrar, plantilla no aprobada…). Una vez resuelto, el botón **Reintentar** lo vuelve a mandar.

## Bueno saber

- **El número no recibe respuestas en ningún lado.** Si un cliente contesta, el mensaje queda en la API sin que nadie lo lea. Por eso los textos dicen "comunicate con el club". La página del club muestra el WhatsApp propio del club si está cargado en *Configuración → Club*: conviene cargarlo.
- **Límites de envío:** un número nuevo arranca con un límite diario de conversaciones que Meta sube solo si la calidad es buena. Verificar el negocio en *Centro de seguridad* ayuda.
- **Un número por instalación:** todos los clubs de esta instalación mandan desde el mismo número; cada mensaje lleva el nombre del club en el texto.
