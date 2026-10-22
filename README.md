# Canchería

Gestión y reserva de turnos para complejos deportivos.

- [Arquitectura, stack y control de concurrencia](docs/arquitectura.md)
- [API pública: endpoints, errores y reglas de negocio](docs/api-publica.md)
- [API del panel de administración: sesiones, roles y operación](docs/api-admin.md)
- [Esquema de base de datos (migración SQL)](packages/db/migrations/0001_init.sql)

## Probarla en tu compu

Requisitos: Node 22.12+, pnpm 10 (`corepack enable`) y Docker.

```bash
pnpm install
cp .env.example .env
pnpm db:up            # Postgres 16 en Docker
pnpm demo:preparar    # migra, carga el club demo "la-canchita" y un usuario dueño
pnpm dev              # API (3001), worker y web (3000) juntos
```

- Página pública del club: http://localhost:3000/la-canchita
- Panel: http://localhost:3000/panel — usuario `demo@cancheria.local`, contraseña `demo-cancheria`

**Sin WhatsApp ni Mercado Pago funciona todo**, con dos diferencias:

- Los mensajes al cliente no salen: se ven en el panel, en **Mensajes** (con el texto exacto que le llegaría), y en la consola del worker.
- La seña se paga por **transferencia**: el cliente sube el comprobante y lo aprobás en **Transferencias**. También podés cobrarla en el club desde el detalle del turno, o configurar un horario sin seña en *Configuración → Seña*.

Para probar desde el celular en la misma red (con la IP de tu compu, por ejemplo `192.168.0.10`): en `.env` poné `URL_WEB=http://192.168.0.10:3000`, `WEB_ORIGIN=http://192.168.0.10:3000` y `URL_API=http://192.168.0.10:3001`; en `apps/web/.env.local`, `NEXT_PUBLIC_API_URL=http://192.168.0.10:3001`. Reiniciá `pnpm dev` y abrí `http://192.168.0.10:3000/la-canchita` en el celular.

Otros usuarios para el panel (la contraseña se genera y se muestra una vez, o se toma de `CONTRASENA`):

```bash
pnpm --filter @cancheria/api admin:crear-usuario vos@mail.com "Tu nombre" la-canchita OWNER
```

Para probar Mercado Pago con credenciales de prueba de tu cuenta:

```bash
pnpm --filter @cancheria/servicios mp:configurar la-canchita TEST-xxxx-access-token [clave_secreta_webhooks]
```

Probalo con el club demo:

```bash
curl localhost:3001/public/clubs/la-canchita
curl "localhost:3001/public/clubs/la-canchita/disponibilidad?fecha=$(date -d tomorrow +%F)&jugadores=5"
curl -N localhost:3001/public/clubs/la-canchita/eventos   # tiempo real
```

| Comando | Qué hace |
|---|---|
| `pnpm lint` / `pnpm format` | Biome (lint + formato) |
| `pnpm typecheck` | TypeScript en todos los paquetes |
| `pnpm test` | Vitest; cada corrida crea y borra su propia base temporal |
| `pnpm test:e2e` | Playwright: el front real en Chromium contra una API y una base temporales |
| `pnpm --filter @cancheria/api dev` | API con recarga automática |
| `pnpm --filter @cancheria/worker dev` | Worker con recarga automática |
| `pnpm db:reset` | Borra la base de desarrollo, migra de cero y siembra (deshabilitado en producción) |

## Estructura

```
packages/
  db/           migraciones SQL (fuente de verdad), esquema Drizzle, migrador, seed
    migrations/ 0001_init.sql, 0002_….sql — nunca se editan una vez aplicadas
    src/schema/ tablas tipadas para consultas (test/schema-drift verifica que coincidan con la base)
    test/       concurrencia, expiración de holds, triggers, drift del esquema
  core/         dominio puro: zona horaria, grilla, tarifas, reglas de seña, teléfonos
  servicios/    lógica con base de datos compartida por api y worker: pagos (Mercado Pago,
                transferencia), reembolsos, lista de espera, expiración, notificaciones,
                sesiones del panel y operación diaria (carga manual, check-in, cobros)
apps/
  api/          Fastify: API pública, panel de admin (/admin), webhooks de MP, SSE
  worker/       tareas periódicas (expiración + conciliación, WhatsApp, reembolsos)
  web/          Next.js 16: página pública del club (/[slug]), comprobante (/r/[codigo])
                y panel (/panel). Tailwind 4, TanStack Query, SSE para el tiempo real.
    e2e/        tests de punta a punta con Playwright
```

### Cambios al esquema

1. Crear `packages/db/migrations/000N_descripcion.sql` (el migrador rechaza cambios en migraciones ya aplicadas).
2. Reflejar el cambio en `packages/db/src/schema/`.
3. `pnpm test`: el test de drift falla si las tablas, columnas, tipos, nulabilidad o enums no coinciden.

### Producción

Antes de cobrar de verdad:

1. **Firma de webhooks de MP:** mandar una notificación de prueba desde el panel de MP y verificar en los logs que no aparezca `webhook de MP con firma inválida`. Aunque la firma fallara, los pagos se confirman igual por la conciliación del worker (con hasta 30 s de demora), pero conviene que ande.
2. **WhatsApp:** número, token y plantillas en Meta. Paso a paso en [docs/whatsapp.md](docs/whatsapp.md); las 7 plantillas se cargan con `pnpm whatsapp:plantillas crear`. El worker se niega a arrancar en producción sin `WHATSAPP_TOKEN` y `WHATSAPP_PHONE_NUMBER_ID`.
3. **Comprobantes:** hoy se guardan en disco (`DIR_COMPROBANTES`). En producción implementar `AlmacenArchivos` sobre S3/R2 (la interfaz ya está).
4. **`CLAVE_CREDENCIALES`:** generar una propia (no la de `.env.example`) y guardarla como secreto. Si se pierde, hay que volver a cargar las credenciales de MP de cada club.

5. **Front y API en el mismo dominio** (ej. `app.tuclub.com` y `api.tuclub.com`): el panel usa una cookie `SameSite=Lax` de la API, que el navegador no manda entre sitios distintos (`algo.vercel.app` ↔ `algo.fly.dev`). `NEXT_PUBLIC_API_URL` va embebida en el build del front y `WEB_ORIGIN` de la API tiene que ser la URL del front.

Arrancar la API y el worker con `node` directo (`node --import tsx apps/api/src/server.ts` y `apps/worker/src/main.ts`) y no con `pnpm start`: pnpm no reenvía `SIGTERM` al proceso hijo, y entonces el apagado ordenado no se ejecuta: cerrar los streams SSE en la API y, en el worker, esperar a que terminen los reembolsos y envíos en curso.
