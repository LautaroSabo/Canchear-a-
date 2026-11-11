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
| POST | `/admin/auth/olvide` | `{ email }` → 204 siempre (exista o no). Si la cuenta existe, manda por mail un link de un solo uso que vence en 1 hora |
| POST | `/admin/auth/restablecer` | `{ token, nueva }` → 204. Cierra todas las sesiones. `410 LINK_VENCIDO` · `422 CONTRASENA_CORTA` |

`clubs[]` trae también `estado` (`PENDIENTE` · `ACTIVO` · `SUSPENDIDO`), `motivoSuspension` `abonoHasta` y `abono` (`{ precio, plan, canchas }`: lo que paga por mes según sus canchas activas y su precio especial); la respuesta, `comoPagarAbono` (de `ABONO_COMO_PAGAR`). `usuario.esSuperadmin` marca a quien administra la plataforma.

## Registro de clubes y plataforma

| Método | Ruta | Quién | Descripción |
|---|---|---|---|
| GET | `/admin/registro/slug?slug=` | público | `{ disponible, motivo }` |
| POST | `/admin/registro` | público (5/min por IP) | `{ club: { nombre, slug, telefono, direccion? }, dueno: { nombre, email, contrasena } }` → 201 `{ clubId, usuario, clubs }` + cookie de sesión. El club queda `PENDIENTE`: se ve en `/public/clubs/:slug` con `habilitado: false` y las reservas y la lista de espera responden `403 CLUB_NO_HABILITADO`. `409 EMAIL_EN_USO` · `409 SLUG_EN_USO` · `422 SLUG_INVALIDO` |
| POST | `/admin/plataforma/restablecer` | superadmin | `{ email }` → `{ link, venceEnMinutos }` para mandarlo por WhatsApp. `404 USUARIO_NO_ENCONTRADO` |
| GET | `/admin/plataforma/clubs` | superadmin | `{ hoy, clubs: [{ …, estado, abonoHasta, dueno, canchas, turnosUltimos30Dias }] }` |
| POST | `/admin/plataforma/clubs/:id/aprobar` | superadmin | `{ diasPrueba }` → 204. Pasa a `ACTIVO`; la prueba cubre el abono desde hoy |
| POST | `/admin/plataforma/clubs/:id/suspender` | superadmin | `{ motivo }` → 204 |
| POST | `/admin/plataforma/clubs/:id/reactivar` | superadmin | 204 |
| GET / POST | `/admin/plataforma/clubs/:id/pagos` | superadmin | Historial / `{ meses, monto, medio (TRANSFERENCIA · MERCADO_PAGO · EFECTIVO · OTRO), nota? }` → 201. Extiende `abonoHasta` desde el día siguiente al último cubierto (o desde hoy, si estaba vencido) |

Cada registro manda un mail a `AVISOS_EMAIL` (por Resend con `RESEND_API_KEY`, o por SMTP con `SMTP_*`), en segundo plano: si falla, se loguea y el alta queda igual.

Para quien no es superadmin, las rutas de `/plataforma` responden 404. Se marca con `pnpm superadmin <email>`.

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

## Reportes — `/admin/clubs/:clubId/reportes` (ADMIN)

Período en fechas locales del club (`desde` y `hasta` inclusive, hasta 366 días).

| Método | Ruta | Descripción |
|---|---|---|
| GET | `?desde=&hasta=` | Resumen: `ocupacion` (minutos-cancha `disponible`/`ocupado`, `porcentaje`, `mapa[díaSemana][hora]`, `porCancha`), `dinero` (cobrado de turnos neto de devoluciones + cantina de mostrador, `porMedio`, `porConcepto`, descuentos por puntos, `porCobrar` de turnos jugados con saldo), `turnos` (`porEstado`, `porOrigen`, `jugados`, `ausentismo`), `clientes` (nuevos, más frecuentes, más ausencias), `cantina` y `porDia` |
| GET | `/exportar?tipo=turnos\|pagos\|ventas&desde=&hasta=` | CSV para Excel en castellano (`;`, coma decimal, BOM UTF-8). Las celdas que empiezan con `= + - @` se escapan con `'` (inyección de fórmulas) |

**Ocupación:** se calcula por bloques de una hora local. Lo disponible es el horario abierto de cada cancha activa (horarios + feriados; la madrugada de una jornada que cierra tarde cuenta en el día calendario siguiente), menos los bloqueos. Lo ocupado son los turnos confirmados, jugados o ausentes, y nunca pasa lo disponible. Lo cobrado se cuenta por la fecha de acreditación del pago, no por la del turno.

## Clientes y puntos — `/admin/clubs/:clubId/…`

**Acumulación:** el check-in suma `clubs.puntos_por_partido`, o lo que dé la mejor promoción vigente para el día y la hora de inicio del turno (`multiplicador` y `puntosExtra`; no se acumulan dos). La respuesta del check-in trae `puntosGanados` y el comprobante público muestra `puntos: { ganados, saldo }`. Un turno suma una sola vez (índice único). Con 0 puntos por partido el club no usa puntos.

**Saldo:** `clientes.saldo_puntos` es una caché de `movimientos_puntos` (`ACUMULACION`, `CANJE`, `AJUSTE`, `REVERSION`), actualizada en la misma transacción con la fila del cliente bloqueada: dos canjes simultáneos no pueden gastar los mismos puntos.

**Canjes:** los premios de producto se entregan en el momento (`USADO`). Los de descuento (`DESCUENTO_MONTO`, `DESCUENTO_PORCENTAJE`, `TURNO_GRATIS`) quedan `EMITIDO` hasta aplicarse a un turno **del mismo cliente** (confirmado o en cancha). El descuento es sobre el precio del turno, nunca sobre la cantina, y nunca deja saldo a favor: si ya pagó una parte, descuenta solo lo que falta. Baja el saldo del turno (`descuentos` en la agenda y el detalle).

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | `/clientes?q=` | RECEPCION | Búsqueda por nombre o por los últimos dígitos del teléfono: `[{ id, nombre, telefono, saldoPuntos, bloqueado, partidos }]` |
| GET | `/clientes/:clienteId` | RECEPCION | Ficha: partidos, ausencias, cancelados, último partido, movimientos de puntos, canjes y próximos turnos |
| POST | `/clientes/:clienteId/ajuste-puntos` | ADMIN | `{ puntos (con signo), motivo }` → `{ saldoPuntos }`. `409 PUNTOS_INSUFICIENTES` si quedaría negativo |
| GET | `/fidelizacion` | RECEPCION | `{ puntosPorPartido, premios, promociones }` |
| PUT | `/fidelizacion/puntos-por-partido` | ADMIN | `{ puntos }` |
| POST · PUT | `/fidelizacion/premios[/:premioId]` | ADMIN | `{ nombre, descripcion, costoPuntos, tipo, valor (centavos o %), stock \| null, activo }` |
| POST · PUT · DELETE | `/fidelizacion/promociones[/:promocionId]` | ADMIN | `{ nombre, diaSemana, horaDesde, horaHasta, multiplicador, puntosExtra, vigenteDesde, vigenteHasta, activa }` |
| POST | `/fidelizacion/canjes` | RECEPCION | `{ clienteId, premioId, turnoId? }` → `201 { id, codigo, estado, montoAplicado, saldoPuntos }`. `409 PUNTOS_INSUFICIENTES`, `409 PREMIO_AGOTADO` |
| POST | `/fidelizacion/canjes/:canjeId/aplicar` | RECEPCION | `{ turnoId }` → `{ montoAplicado }`. `422 TURNO_DE_OTRO_CLIENTE`, `409 TURNO_PAGADO`, `409 CANJE_USADO` |
| POST | `/fidelizacion/canjes/:canjeId/anular` | RECEPCION | `{ motivo }`: devuelve los puntos, el stock del premio y, si estaba aplicado, el descuento |

`GET /turnos/:turnoId` incluye `canjes: { saldoPuntos, aplicados, disponibles }` (los de descuento que el cliente tiene sin usar).

## Cantina — `/admin/clubs/:clubId/cantina/…`

Una venta es un ticket que **o se cobra en el momento** (`medio`) **o se carga a la cuenta de un turno** (`turnoId`, solo turnos `CONFIRMADO` o `PRESENTE`). Lo cargado a un turno suma al saldo (`consumos` en la agenda, el detalle y el check-in) y se cobra con el saldo. El stock se descuenta con un `UPDATE … WHERE stock >= cantidad` dentro de la transacción de la venta: todo o nada, y dos cajas no pueden vender el último a la vez. Cada cambio de stock queda en `movimientos_stock` (venta, anulación, reposición, ajuste) con usuario y motivo.

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | `/productos` | RECEPCION | Productos a la venta (`?inactivos=true` incluye los dados de baja) |
| POST | `/productos` | ADMIN | `{ nombre, categoria (BEBIDA/COMIDA/ALQUILER/OTRO), precio, controlaStock, stockMinimo, activo, stockInicial }`. `409 NOMBRE_EN_USO` |
| PATCH | `/productos/:productoId` | ADMIN | Cualquier subconjunto de los datos (el stock no: se mueve con reposición o ajuste). El precio nuevo no cambia las ventas hechas. |
| POST | `/productos/:productoId/reposicion` | RECEPCION | `{ cantidad, motivo? }` → `{ stock }` |
| POST | `/productos/:productoId/ajuste` | ADMIN | Conteo físico: `{ stock, motivo }` → `{ stock }`; la diferencia queda en el libro |
| GET | `/productos/:productoId/movimientos` | ADMIN | Últimos 50 movimientos de stock |
| POST | `/ventas` | RECEPCION | `{ items: [{ productoId, cantidad }], medio? \| turnoId?, idempotencyKey? }` → `201` con la venta y sus renglones (precio congelado). `409 SIN_STOCK` con `detalle.disponible`, `409 TURNO_SIN_CUENTA`, `422 DESTINO_INVALIDO` |
| GET | `/ventas?fecha=` · `?turnoId=` | RECEPCION | Ventas con renglones (incluye anuladas) |
| POST | `/ventas/:ventaId/anular` | RECEPCION | `{ motivo }`. Devuelve el stock. Si era a cuenta de un turno que ya se cobró y quedaría pagado de más: `409 VENTA_COBRADA` |
| GET | `/resumen?fecha=` | RECEPCION | Caja del día: `cobradoPorMedio`, `cobrado`, `aCuentaDeTurnos`, `ventas`, `anuladas`, `masVendidos`, `stockBajo` |

`GET /turnos/:turnoId` incluye `ventas` (lo cargado a ese turno) y `consumos`.

## Turnos fijos — `/admin/clubs/:clubId/turnos-fijos` (RECEPCION)

El mismo cliente, cancha y horario cada 1, 2 o 4 semanas. Se guarda como plantilla y se materializa en turnos `CONFIRMADO` con origen `FIJO` (sin seña) hasta **8 semanas** adelante: al crearlo y después el worker cada hora. Una fecha que choca con otro turno **nunca lo pisa**: queda como *omitida* (`OCUPADO`, `CERRADO` por feriado u horario, `SIN_TARIFA`) para que el club la resuelva.

| Método | Ruta | Descripción |
|---|---|---|
| GET | `` | `[{ id, cancha, cliente, diaSemana, horaInicio, duracionMin, frecuenciaSemanas, vigenteDesde, vigenteHasta, precioPactado, nota, activo, proximo, omitidos: [{ fecha, motivo, conflicto }] }]` |
| GET | `/pendientes` | `{ omitidos }`: fechas omitidas sin revisar (para el aviso del menú) |
| POST | `/previsualizar` | `{ canchaId, diaSemana, horaInicio, duracionMin?, frecuenciaSemanas, vigenteDesde, vigenteHasta?, precioPactado? }` → `{ vigenteDesde, duracionMin, ocurrencias: [{ fecha, inicio, fin, estado, precio, conflicto }] }`. No escribe nada. |
| POST | `` | Lo mismo + `cliente: { nombre, telefono }`, `nota?`, `notificar?` → `201 { id, creados, omitidos }`. `vigenteDesde` se corre al primer día que coincide. Por defecto le avisa al cliente por WhatsApp (plantilla `turno_fijo_creado`). |
| PATCH | `/:fijoId` | `{ precioPactado?: centavos \| null, nota? }` → `{ actualizados }`. `null` = la tarifa de cada fecha. El precio nuevo se aplica a los turnos ya generados sin pagos. |
| POST | `/:fijoId/baja` | `{ desde, motivo? }` → `{ cancelados, conPagos }`. La última fecha pasa a ser la anterior a `desde`; los turnos generados desde ahí se cancelan y se ofrecen a la lista de espera, salvo los que tienen pagos (`conPagos`), que quedan para decidir desde la agenda. |
| POST | `/:fijoId/omitidos/:fecha/reintentar` | `{ creado, motivo }`: vuelve a intentar una fecha omitida (por ejemplo, después de mover el turno que chocaba) |
| DELETE | `/:fijoId/omitidos/:fecha` | El club ya la resolvió (le avisó al cliente, etc.) |

Para saltear una sola semana se cancela ese turno desde la agenda: no se vuelve a generar (índice único `(turno_fijo_id, inicio)`).

## Caja — `/admin/clubs/:clubId/caja`

Lo cobrado entre el último cierre y ahora (el primero, desde el comienzo del día), por medio de pago: señas, saldos de turnos, cantina de mostrador y devoluciones (restan). Cada cierre arranca donde terminó el anterior, así sirve por turno de trabajo.

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | `` | RECEPCION | `{ desde, hasta, porMedio: [{ medio, senas, saldos, cantina, devoluciones, total }], total, efectivoEsperado, movimientos, ultimoCierre }` |
| POST | `/cierres` | RECEPCION | `{ efectivoContado, nota? }` (centavos) → `201 { id, desde, hasta, efectivoEsperado, efectivoContado, diferencia, nota }`. Diferencia positiva: sobra. `409 RECIEN_CERRADA` si otro acaba de cerrar |
| GET | `/cierres` | ADMIN | Los últimos 30 cierres, con quién cerró |

## Torneos y ligas — `/admin/clubs/:clubId/torneos`

Una liga es **1 grupo sin eliminación**; un torneo con grupos suma una **eliminación directa** con los mejores de cada grupo (`clasificanPorGrupo`). El torneo pasa por `INSCRIPCION` → `EN_CURSO` (al sortear) → `FINALIZADO` (al jugarse la final, o el último partido de una liga, o a mano).

Al **sortear**, la app mezcla los equipos aprobados, los reparte en grupos, arma el fixture (todos contra todos, ida y vuelta opcional) y agenda cada partido en un hueco libre de las canchas del torneo, en sus días y franja horaria, desde `fechaInicio`. Cada fecha va en un día distinto y posterior a la anterior. Cada partido queda como **bloqueo** en la agenda (`origen: BLOQUEO`, nota `Torneo: A vs B`), así que no se puede reservar encima. La eliminación se agenda igual, después del último partido de grupos: todas las rondas quedan con horario y los equipos se completan con cada resultado (el ganador de `(ronda, orden)` pasa a `(ronda/2, orden/2)`). Con clasificados que no son potencia de 2, los mejores pasan directo.

Tabla: 3 puntos por victoria y 1 por empate; desempata diferencia de gol, goles a favor, resultado entre ellos y orden de inscripción. En la eliminación un empate se define por penales.

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | `` | RECEPCION | `[{ id, nombre, slug, estado, jugadoresPorLado, inscripcionOnline, fechaInicio, equipos, pendientes }]` |
| POST | `` | ADMIN | `{ nombre, descripcion?, jugadoresPorLado, inscripcionOnline, cantidadGrupos, idaYVuelta, clasificanPorGrupo, dias: [0-6], horaDesde, horaHasta, canchaIds, fechaInicio, duracionMin }` → `201 { id, slug }`. `horaHasta <= horaDesde` = termina después de medianoche. `422 FRANJA_CORTA`, `CANCHA_INVALIDA` |
| GET | `/:torneoId` | RECEPCION | `{ torneo, equipos (con delegado), grupos: [{ numero, tabla }], partidos, eliminacionPendiente }` |
| PUT · DELETE | `/:torneoId` | ADMIN | Cambiar el formato o borrar: solo en `INSCRIPCION` (`409 TORNEO_EMPEZADO`) |
| POST | `/:torneoId/equipos` | ADMIN | `{ nombre, delegadoNombre, delegadoTelefono }` → `201`, ya aprobado. `409 EQUIPO_REPETIDO` |
| PATCH · DELETE | `/:torneoId/equipos/:equipoId` | ADMIN | `{ estado: APROBADO \| RECHAZADO }` (para las inscripciones online) o quitarlo |
| POST | `/:torneoId/iniciar` | ADMIN | `{ sortear?: true }`: sortea, agenda y pasa a `EN_CURSO` → vista. `422 POCOS_EQUIPOS` (2 por grupo), `422 SIN_LUGAR` (no entra en un año) |
| PUT | `/:torneoId/partidos/:partidoId/resultado` | RECEPCION | `{ golesLocal, golesVisitante, penalesLocal?, penalesVisitante? }` → vista. Se puede corregir; en la eliminación, no si el partido siguiente ya se jugó (`409 SIGUIENTE_JUGADO`). `422 FALTAN_PENALES` |
| POST | `/:torneoId/partidos/:partidoId/mover` | ADMIN | `{ inicio, canchaId }` → vista. Libera el bloqueo anterior y toma el nuevo; `409 HORARIO_OCUPADO` si está tomado |
| POST | `/:torneoId/eliminacion` | ADMIN | Con todos los partidos de grupos jugados: arma y agenda el cuadro → vista |
| POST | `/:torneoId/finalizar` | ADMIN | Lo da por terminado |

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
