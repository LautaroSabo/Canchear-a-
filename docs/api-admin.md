# API del panel de administración

Base: `/admin`. Mismo formato de error que la API pública (`{ "error": { "codigo", "mensaje", "detalle" } }`). Importes en centavos, instantes en ISO 8601 UTC.

## Seguridad

- **Sesión por cookie** `cancheria_sesion`: `HttpOnly`, `SameSite=Lax`, `Path=/admin` y `Secure` en producción. Dura 7 días y se renueva sola mientras se use. En la base se guarda solo el SHA-256 del token.
- **CSRF:** toda request que no sea GET tiene que mandar el header `x-cancheria-csrf: 1`. Sin él se responde `403 CSRF`. Desde el front: `fetch(url, { credentials: 'include', headers: { 'x-cancheria-csrf': '1' } })`.
- **Roles por club:** `RECEPCION` < `ADMIN` < `OWNER`. Cada ruta indica el rol mínimo (por defecto RECEPCION).
  - Sin sesión → `401 NO_AUTENTICADO`.
  - No ser miembro del club → `404 CLUB_NO_ENCONTRADO`, igual que si el club no existiera.
  - Rol insuficiente → `403 PERMISO_INSUFICIENTE`.
- **Login:** 10 intentos por minuto por IP. El mensaje de error es el mismo si el email no existe o si la contraseña está mal.
- **Contraseñas:** scrypt (N=2^15) con sal aleatoria.

Alta de usuarios (hasta que exista la gestión desde el panel):

```bash
pnpm --filter @cancheria/api admin:crear-usuario recepcion@club.com "Recepción" la-canchita RECEPCION
# contraseña: variable CONTRASENA, o se genera una y se muestra una sola vez
```

## Sesión

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/admin/auth/login` | `{ email, contrasena }` → `{ usuario, clubs: [{ id, slug, nombre, zonaHoraria, rol }] }` + cookie |
| POST | `/admin/auth/logout` | 204; borra la sesión |
| GET | `/admin/auth/yo` | Usuario actual y sus clubs |
| POST | `/admin/auth/contrasena` | `{ actual, nueva }` (≥ 10 caracteres) → 204. Cierra las otras sesiones del usuario. `422 CONTRASENA_ACTUAL_INCORRECTA` |

## Operación diaria — `/admin/clubs/:clubId/…` (RECEPCION)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/agenda?fecha=YYYY-MM-DD[&incluirCancelados=true]` | Canchas, horario de apertura y turnos del día (incluida la madrugada si el club cierra tarde). Cada turno trae cliente, `pagado`, `saldo`, `senaEnRevision` y `nota`. Los holds vencidos no aparecen. |
| GET | `/eventos` | SSE: `event: turno` ante cada cambio; el front vuelve a pedir la agenda |
| GET | `/turnos/:turnoId` | Detalle: pagos (con su reembolso), código del QR e historial de estados con quién hizo cada cambio |
| POST | `/turnos` | Carga manual: `{ canchaId, inicio, fin?, cliente: { nombre, telefono, dni? }, precio?, nota?, notificar? }`. Queda CONFIRMADO; acepta horarios fuera de la grilla. `409 TURNO_OCUPADO` trae `detalle.conflictos` con el turno que molesta. |
| POST | `/bloqueos` | `{ canchaId, inicio, fin, motivo }`: ocupa la cancha sin cliente (mantenimiento, eventos) |
| POST | `/turnos/:turnoId/cancelar` | `{ motivo, devolverSena, notificar? }` → `{ senaADevolver, ofertaListaEspera }`. Avisa al cliente y, si el turno no empezó, se lo ofrece a la lista de espera. |
| POST | `/turnos/:turnoId/ausente` | CONFIRMADO que ya empezó → AUSENTE |
| POST | `/turnos/:turnoId/pagos` | Cobro en el club: `{ monto, medio: EFECTIVO\|TRANSFERENCIA\|OTRO, concepto: SENA\|SALDO }` → resumen con `saldo`. La seña confirma una reserva pendiente (o una vencida, si el horario sigue libre). |
| POST | `/checkin` | `{ qr, forzar? }`. `qr` es lo que lee la cámara: la URL del comprobante o el código. → `{ yaRegistrado, estado: PRESENTE, saldo, … }`. Errores: `QR_INVALIDO`, `NO_CONFIRMADO` (falta la seña), `FUERA_DE_HORARIO` (se acepta desde 1 h antes hasta el fin; `forzar: true` lo saltea). |

## Transferencias y reembolsos

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | `/transferencias?estado=EN_REVISION` | RECEPCION | Comprobantes a revisar (más viejos primero) |
| GET | `/pagos/:pagoId/comprobante` | RECEPCION | El archivo (imagen o PDF) |
| POST | `/pagos/:pagoId/aprobar` | RECEPCION | Confirma el turno, o registra la devolución si el horario ya se ocupó |
| POST | `/pagos/:pagoId/rechazar` | RECEPCION | `{ motivo }`: avisa al cliente, que puede subir otro |
| GET | `/reembolsos[?estado=…]` | RECEPCION | `manual: true` = el club tiene que devolver la plata (transferencia, efectivo o MP fallido) |
| POST | `/reembolsos/:id/hecho` | ADMIN | Marca una devolución manual como hecha. Las de MP pendientes no se pueden marcar (`409 REEMBOLSO_AUTOMATICO`), porque las ejecuta el worker. |

## Medios de cobro

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | `/mercadopago` | ADMIN | `{ configurado, conWebhookSecret, urlWebhook }`. El token nunca se devuelve. |
| PUT | `/mercadopago` | OWNER | `{ accessToken, webhookSecret? }`. Se valida contra MP antes de guardarse (`422 CREDENCIALES_MP_INVALIDAS`) y se guarda cifrado. |
| DELETE | `/mercadopago` | OWNER | Deja de cobrar con MP |
| PUT | `/transferencia` | ADMIN | `{ alias?, cbu?, titular }`. Alias o CBU/CVU (22 dígitos) obligatorio. |
| DELETE | `/transferencia` | ADMIN | Deja de aceptar transferencias |

## Configuración del club — `/admin/clubs/:clubId/config/…`

Cada cambio se hace en una transacción que bloquea la fila del club (dos admins editando a la vez no pueden dejar dos tarifas superpuestas) y al terminar invalida la caché de configuración: la grilla pública lo refleja en la siguiente consulta. Las horas van como `HH:MM` en la zona del club; los precios y montos fijos, en centavos.

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | `` | ADMIN | `{ club, canchas, tarifas, horarios, diasEspeciales, reglas, avisos }`. `avisos` lista problemas de configuración: sin canchas, sin horarios, horarios sin tarifa (por cancha y día, con los rangos), seña sin medio de pago, club sin teléfono. |
| PATCH | `/club` | ADMIN | `{ nombre?, telefono?, direccion?, minutosRevisionTransferencia? }` → 204 |
| POST | `/canchas` | ADMIN | `{ nombre, jugadoresPorLado, superficie, techada, iluminacion, duracionTurnoMin (30/60/90/120), orden, activa }` → `{ id }`. `409 NOMBRE_EN_USO` |
| PATCH | `/canchas/:canchaId` | ADMIN | Cualquier subconjunto de lo anterior. Las canchas no se borran: se desactivan (`activa: false`) y dejan de verse en el público. |
| POST | `/tarifas` | ADMIN | `{ canchaId \| null, diaSemana \| null, horaDesde, horaHasta, precio, etiqueta, vigenteDesde, vigenteHasta \| null }` → `{ id }` |
| PUT · DELETE | `/tarifas/:tarifaId` | ADMIN | Reemplaza o borra |
| PUT | `/horarios` | ADMIN | Array `[{ diaSemana, abre, cierra }]`: reemplaza la semana entera. `cierra` < `abre` = cierra después de medianoche. `422 HORARIOS_SUPERPUESTOS` |
| PUT · DELETE | `/dias-especiales/:fecha` | ADMIN | `{ cerrado, abre, cierra, motivo }` (upsert por fecha). `422 HORARIO_INCOMPLETO` |
| POST | `/reglas` | ADMIN | Regla de seña: `{ nombre, canchaId, diaSemana, horaDesde, horaHasta, requiereSena, tipoSena (PORCENTAJE/MONTO_FIJO), valorSena, minutosExpiracion, margenMinAntesInicio, prioridad, activa }` → `{ id }` |
| PUT · DELETE | `/reglas/:reglaId` | ADMIN | Reemplaza o borra |
| GET | `/usuarios` | OWNER | `[{ id, email, nombre, activo, rol }]` |
| POST | `/usuarios` | OWNER | `{ email, nombre, rol }` → `{ usuarioId, contrasenaGenerada }`. Si el email ya tiene cuenta (de otro club) solo se le suma el rol y `contrasenaGenerada` es `null`. `409 YA_ES_MIEMBRO` |
| PATCH | `/usuarios/:usuarioId` | OWNER | `{ rol }` |
| DELETE | `/usuarios/:usuarioId` | OWNER | Le saca el acceso; si no le quedan clubs, se cierran sus sesiones |

Reglas de las tarifas:

- **Superposición:** dos tarifas con el mismo alcance (misma cancha o ambas generales, mismo día o ambas de todos los días) no pueden pisarse en horario y vigencia a la vez → `409 TARIFA_SUPERPUESTA`, con la tarifa con la que choca en el mensaje. Con distinto alcance sí pueden convivir: gana la más específica.
- **Medianoche:** una tarifa termina como mucho a las `00:00`; lo que sigue va en otra desde las `00:00` (`422 FRANJA_INVALIDA`).
- **Aumentos programados:** se carga la tarifa nueva con `vigenteDesde` y se le pone `vigenteHasta` a la anterior.
- **Último dueño:** el club siempre conserva al menos un `OWNER` (`409 ULTIMO_DUENO` al bajarle el rol o quitarlo).
