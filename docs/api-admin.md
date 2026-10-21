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
