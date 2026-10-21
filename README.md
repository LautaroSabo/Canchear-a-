# Canchería

Gestión y reserva de turnos para complejos deportivos.

- [Arquitectura, stack y control de concurrencia](docs/arquitectura.md)
- [API pública: endpoints, errores y reglas de negocio](docs/api-publica.md)
- [Esquema de base de datos (migración SQL)](packages/db/migrations/0001_init.sql)

## Desarrollo local

Requisitos: Node 22.12+, pnpm 10 (`corepack enable`) y Docker.

```bash
pnpm install
cp .env.example .env
pnpm db:up        # Postgres 16 en Docker
pnpm db:migrate   # aplica packages/db/migrations/*.sql
pnpm db:seed      # club demo "la-canchita"
pnpm test         # incluye la prueba de 50 reservas simultáneas
pnpm --filter @cancheria/api dev   # API en http://localhost:3001
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
| `pnpm --filter @cancheria/api dev` | API con recarga automática |
| `pnpm db:reset` | Borra la base de desarrollo, migra de cero y siembra (deshabilitado en producción) |

## Estructura

```
packages/
  db/           migraciones SQL (fuente de verdad), esquema Drizzle, migrador, seed
    migrations/ 0001_init.sql, 0002_….sql — nunca se editan una vez aplicadas
    src/schema/ tablas tipadas para consultas (test/schema-drift verifica que coincidan con la base)
    test/       concurrencia, expiración de holds, triggers, drift del esquema
  core/         dominio puro: zona horaria, grilla, tarifas, reglas de seña, teléfonos
apps/
  api/          Fastify: API pública (disponibilidad, reservas, SSE)
                (próximos: worker, web)
```

### Cambios al esquema

1. Crear `packages/db/migrations/000N_descripcion.sql` (el migrador rechaza cambios en migraciones ya aplicadas).
2. Reflejar el cambio en `packages/db/src/schema/`.
3. `pnpm test`: el test de drift falla si las tablas, columnas, tipos, nulabilidad o enums no coinciden.

### Producción

Arrancar la API con `node` directo (`node --import tsx apps/api/src/server.ts`) y no con `pnpm start`: pnpm no reenvía `SIGTERM` al proceso hijo, y entonces el apagado ordenado (cerrar los streams SSE y el pool de conexiones) no se ejecuta.
