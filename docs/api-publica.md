# API pública (sin login)

Base: `/public`. Todas las respuestas de error tienen la forma:

```json
{ "error": { "codigo": "TURNO_OCUPADO", "mensaje": "Ese turno se acaba de ocupar", "detalle": { } } }
```

Importes siempre en **centavos** e instantes en **ISO 8601 UTC**. La hora local del club sale de `zonaHoraria`.

## `GET /public/clubs/:slug`

Datos del club, canchas activas (`id`, `nombre`, `jugadoresPorLado`, `superficie`, `techada`, `iluminacion`, `caracteristicas`, `duracionMin`) y medios para pagar la seña:

```json
"mediosPago": { "mercadoPago": true, "transferencia": { "alias": "la.canchita.mp", "titular": "La Canchita SRL" } }
```

## `GET /public/clubs/:slug/disponibilidad?fecha=YYYY-MM-DD[&jugadores=5][&canchaId=…]`

Grilla de la **jornada** `fecha` (fecha local del club). Una jornada que cierra después de medianoche incluye esos turnos: sábado 09:00 → domingo 02:00.

```json
{
  "fecha": "2030-01-05",
  "canchas": [{
    "id": "…", "nombre": "Cancha 1", "jugadoresPorLado": 5, "duracionMin": 60,
    "slots": [{ "inicio": "2030-01-05T23:00:00.000Z", "fin": "…", "estado": "LIBRE",
                "precio": 4500000, "montoSena": 2250000, "requiereSena": true }]
  }]
}
```

`estado`: `LIBRE` · `OCUPADO` · `PASADO`. Un hold vencido figura `LIBRE` en el mismo instante en que vence. Fechas aceptadas: desde ayer hasta 30 días adelante (`422 FECHA_FUERA_DE_RANGO`).

## `POST /public/clubs/:slug/reservas`

```json
{
  "canchaId": "uuid",
  "inicio": "2030-01-05T20:00:00-03:00",
  "cliente": { "nombre": "Lautaro", "telefono": "11 5555-1234", "dni": "30.123.456", "email": "opcional" },
  "idempotencyKey": "uuid generado por el front en cada intento de reserva"
}
```

- `201`: reserva creada. `PRE_RESERVADO` con `expiraEn` si la regla del horario pide seña; `CONFIRMADO` si no la pide.
- `200`: la misma `idempotencyKey` ya había creado una reserva (doble clic o reintento); se devuelve esa.

Respuesta (también la de `GET /public/reservas/:codigo`):

```json
{
  "codigo": "32 hex: va en la URL del comprobante y en el QR",
  "estado": "PRE_RESERVADO",
  "club": { "slug": "la-canchita", "nombre": "La Canchita F5" },
  "cancha": { "id": "…", "nombre": "Cancha 1" },
  "inicio": "…", "fin": "…",
  "precioTotal": 4500000, "montoSena": 2250000, "saldoAPagar": 2250000,
  "expiraEn": "…",
  "senaEnRevision": false,
  "cliente": { "nombre": "Lautaro" }
}
```

| Status | `codigo` | Cuándo |
|---|---|---|
| 400 | `VALIDACION` | Cuerpo inválido (`detalle`: lista de `{ campo, mensaje }`) |
| 403 | `CLIENTE_BLOQUEADO` | El club bloqueó a ese cliente |
| 404 | `CLUB_NO_ENCONTRADO` / `CANCHA_NO_ENCONTRADA` | |
| 409 | `TURNO_OCUPADO` | Otro lo tomó antes. `detalle.alternativas`: hasta 5 turnos libres del mismo tipo de cancha, los más cercanos primero |
| 409 | `DNI_CON_OTRO_TELEFONO` | El DNI ya pertenece a un cliente con otro teléfono |
| 422 | `HORARIO_INVALIDO` | El inicio no coincide con un turno de la grilla |
| 422 | `HORARIO_PASADO` | |
| 422 | `RESERVA_MUY_CERCANA` | Pide seña y empieza tan pronto que no hay tiempo de esperar el pago (`detalle.telefono` del club) |
| 422 | `TELEFONO_INVALIDO` / `SIN_TARIFA` / `FECHA_FUERA_DE_RANGO` | |
| 429 | `DEMASIADAS_SOLICITUDES` | Más de 10 reservas por minuto desde la misma IP |

## `GET /public/reservas/:codigo`

Comprobante de una reserva. Si un `PRE_RESERVADO` ya venció se informa como `EXPIRADO`, aunque el worker todavía no haya pasado.

## Pagar la seña

### `POST /public/reservas/:codigo/mercadopago` → `{ "urlCheckout": "https://www.mercadopago.com.ar/checkout/…" }`

El front redirige ahí. El link vence con la pre-reserva y se reusa si se vuelve a pedir. Al terminar, MP devuelve al cliente al comprobante (`URL_WEB/r/:codigo`); la confirmación llega por webhook, así que el front tiene que volver a consultar `GET /public/reservas/:codigo` o escuchar el SSE.

| Status | `codigo` | Cuándo |
|---|---|---|
| 409 | `RESERVA_NO_PENDIENTE` | Ya está confirmada, venció o se canceló |
| 409 | `SIN_SENA` | Es una oferta sin seña: se acepta con `/confirmar` |
| 422 | `MP_NO_DISPONIBLE` | El club no configuró Mercado Pago |
| 502 | `MP_SIN_RESPUESTA` | MP no responde: ofrecer transferencia |

### `POST /public/reservas/:codigo/transferencia` (multipart, campo `comprobante`)

JPG, PNG, WEBP o PDF de hasta 5 MB. El tipo se valida por el contenido del archivo, no por su nombre. Responde `201 { "estado": "EN_REVISION", "expiraEn": "…" }`: el plazo se extiende para que el club alcance a revisarlo.

Errores: `409 COMPROBANTE_EN_REVISION` (ya hay uno esperando), `413 ARCHIVO_DEMASIADO_GRANDE`, `422 ARCHIVO_INVALIDO`, `422 TRANSFERENCIA_NO_DISPONIBLE`.

### `POST /public/reservas/:codigo/confirmar`

Acepta un turno ofrecido por la lista de espera en un horario que no pide seña. Devuelve el comprobante `CONFIRMADO`. Error: `409 REQUIERE_SENA` si en realidad hay que pagar.

## `POST /public/clubs/:slug/lista-espera`

```json
{
  "cliente": { "nombre": "Sofi", "telefono": "11 4444-9999" },
  "fecha": "2030-01-05", "desde": "19:00", "hasta": "23:00",
  "jugadores": 5
}
```

Franja en hora local del club; si `hasta <= desde`, cruza la medianoche. Opcionalmente `canchaId` en vez de `jugadores`. Responde `201 { "id", "estado": "ACTIVA" }`. Si se libera un turno que entra completo en la franja, se le guarda a la primera persona de la lista y se le avisa por WhatsApp con el link para pagar o aceptar. Error: `409 YA_EN_LISTA` si ya está anotada en una franja que se superpone.

## Webhook de Mercado Pago: `POST /webhooks/mercadopago/:slug`

Para cargar en el panel de desarrolladores de MP de cada club (eventos: *Pagos*). Valida `x-signature` si el club cargó su clave secreta y responde `401 FIRMA_INVALIDA` si no coincide. Notificaciones que no son de pagos se aceptan con `200 { "ignorado": true }`.

## `GET /public/clubs/:slug/eventos` (Server-Sent Events)

```
event: turno
data: {"canchaId":"…","inicio":"2030-01-05T23:00:00.000Z","estado":"PRE_RESERVADO"}
```

Se emite un evento por cada alta o cambio de estado de un turno del club, solo después del COMMIT. No incluye datos personales: ante cada evento el front vuelve a pedir la disponibilidad de ese día. Hay un latido cada 25 s y el navegador reconecta solo (`retry: 3000`).

## Reglas de negocio de esta versión

- **Identidad del cliente:** el teléfono, normalizado a `+549…` (los formatos `11 5555-1234`, `+54 9 11…` y `011 15…` son el mismo cliente). Si el cliente ya existe no se le cambia el nombre, solo se completa el DNI o el email si faltaban.
- **Precio y seña:** los define la hora y el día calendario en que **empieza** el turno.
- **Turnos inminentes con seña:** se rechazan (`RESERVA_MUY_CERCANA`) si quedan menos de 3 minutos para pagar después de aplicar el margen previo al inicio. Los horarios sin seña se pueden reservar sobre la hora.
- **Pagos que no corresponden** (llegaron tarde con el horario ya ocupado, duplicados o por menos de la seña): se devuelven automáticamente por Mercado Pago y se le avisa al cliente.
