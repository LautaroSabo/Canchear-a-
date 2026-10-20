-- =============================================================================
-- Canchería — Esquema relacional (PostgreSQL 16+)
-- =============================================================================
-- Convenciones:
--   * PK uuid (la app genera UUIDv7 para que los índices queden ordenados;
--     gen_random_uuid() queda como default de respaldo).
--   * Todo es multi-tenant: cada tabla de negocio lleva club_id.
--   * Fechas/horas siempre timestamptz (UTC en disco). La zona horaria de
--     cada club vive en clubs.zona_horaria y se aplica al mostrar/calcular.
--   * Dinero en centavos (bigint). Nunca float.
--   * La garantía anti-sobrerreserva es una EXCLUSION CONSTRAINT en turnos:
--     la base de datos rechaza el solapamiento aunque la app tenga un bug.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;  -- permite "=" sobre uuid dentro de un índice GiST
CREATE EXTENSION IF NOT EXISTS citext;      -- emails/slugs case-insensitive
CREATE EXTENSION IF NOT EXISTS pgcrypto;    -- gen_random_bytes() para tokens de QR / canje

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
CREATE TYPE estado_turno AS ENUM (
  'PRE_RESERVADO',  -- hold temporal esperando seña (tiene expira_en)
  'CONFIRMADO',     -- seña pagada o reserva sin seña / manual
  'PRESENTE',       -- check-in hecho (jugado)
  'AUSENTE',        -- no se presentó
  'CANCELADO',
  'EXPIRADO'        -- el hold venció sin pago
);
CREATE TYPE origen_turno     AS ENUM ('WEB', 'MANUAL', 'FIJO', 'BLOQUEO');
CREATE TYPE tipo_superficie  AS ENUM ('SINTETICO', 'CESPED_NATURAL', 'CEMENTO', 'PARQUET', 'OTRO');
CREATE TYPE rol_miembro      AS ENUM ('OWNER', 'ADMIN', 'RECEPCION');
CREATE TYPE proveedor_pago   AS ENUM ('MERCADO_PAGO', 'TRANSFERENCIA', 'EFECTIVO', 'OTRO');
CREATE TYPE concepto_pago    AS ENUM ('SENA', 'SALDO', 'CONSUMO', 'REEMBOLSO');
CREATE TYPE estado_pago      AS ENUM ('PENDIENTE', 'EN_REVISION', 'APROBADO', 'RECHAZADO', 'REEMBOLSADO');
CREATE TYPE tipo_sena        AS ENUM ('PORCENTAJE', 'MONTO_FIJO');
CREATE TYPE estado_espera    AS ENUM ('ACTIVA', 'NOTIFICADA', 'CONVERTIDA', 'VENCIDA', 'CANCELADA');
CREATE TYPE canal_notif      AS ENUM ('WHATSAPP', 'SMS', 'PUSH', 'EMAIL');
CREATE TYPE estado_notif     AS ENUM ('PENDIENTE', 'ENVIADA', 'FALLIDA');
CREATE TYPE tipo_mov_puntos  AS ENUM ('ACUMULACION', 'CANJE', 'AJUSTE', 'REVERSION');
CREATE TYPE tipo_premio      AS ENUM ('DESCUENTO_MONTO', 'DESCUENTO_PORCENTAJE', 'TURNO_GRATIS', 'PRODUCTO');
CREATE TYPE estado_canje     AS ENUM ('EMITIDO', 'USADO', 'ANULADO');

-- -----------------------------------------------------------------------------
-- Clubs y usuarios de administración
-- -----------------------------------------------------------------------------
CREATE TABLE clubs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug           citext NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{3,60}$'),
  nombre         text   NOT NULL,
  zona_horaria   text   NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
  telefono       text,
  direccion      text,
  logo_url       text,
  moneda         char(3) NOT NULL DEFAULT 'ARS',
  -- fidelización
  puntos_por_partido integer NOT NULL DEFAULT 10 CHECK (puntos_por_partido >= 0),
  -- integraciones (tokens cifrados a nivel app / KMS, nunca en texto plano)
  mp_credenciales_cifradas bytea,
  datos_transferencia      jsonb,          -- CBU/alias para mostrar al cliente
  activo         boolean NOT NULL DEFAULT true,
  creado_en      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE usuarios (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          citext NOT NULL UNIQUE,
  nombre         text   NOT NULL,
  password_hash  text   NOT NULL,          -- argon2id
  creado_en      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE miembros_club (
  club_id    uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  usuario_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  rol        rol_miembro NOT NULL,
  PRIMARY KEY (club_id, usuario_id)
);

-- Horario de apertura por día (0=domingo … 6=sábado, como EXTRACT(DOW)).
-- cierra <= abre significa que cierra al día siguiente (ej. 16:00 → 02:00).
CREATE TABLE horarios_apertura (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id     uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  dia_semana  smallint NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),
  abre        time NOT NULL,
  cierra      time NOT NULL,
  UNIQUE (club_id, dia_semana, abre)
);

-- Feriados / cierres excepcionales
CREATE TABLE dias_especiales (
  club_id  uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  fecha    date NOT NULL,
  cerrado  boolean NOT NULL DEFAULT true,
  abre     time,
  cierra   time,
  motivo   text,
  PRIMARY KEY (club_id, fecha)
);

-- -----------------------------------------------------------------------------
-- Canchas y tarifas
-- -----------------------------------------------------------------------------
CREATE TABLE canchas (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id            uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  nombre             text NOT NULL,
  jugadores_por_lado smallint NOT NULL CHECK (jugadores_por_lado BETWEEN 3 AND 11), -- F5, F7, F11…
  superficie         tipo_superficie NOT NULL DEFAULT 'SINTETICO',
  techada            boolean NOT NULL DEFAULT false,
  iluminacion        boolean NOT NULL DEFAULT true,
  caracteristicas    jsonb NOT NULL DEFAULT '{}',   -- vestuarios, parrilla, etc.
  duracion_turno_min smallint NOT NULL DEFAULT 60 CHECK (duracion_turno_min IN (30, 60, 90, 120)),
  orden              smallint NOT NULL DEFAULT 0,
  activa             boolean NOT NULL DEFAULT true,
  UNIQUE (club_id, nombre),
  UNIQUE (club_id, id)   -- permite FKs compuestas que fuerzan "misma cancha, mismo club"
);

-- Precio por franja (pico / valle). Se elige la franja más específica:
-- cancha_id NOT NULL gana a cancha_id NULL (precio general del club).
CREATE TABLE tarifas (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id      uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  cancha_id    uuid REFERENCES canchas(id) ON DELETE CASCADE,
  dia_semana   smallint CHECK (dia_semana BETWEEN 0 AND 6),   -- NULL = todos los días
  hora_desde   time NOT NULL,
  hora_hasta   time NOT NULL,
  precio       bigint NOT NULL CHECK (precio >= 0),            -- centavos por turno
  etiqueta     text,                                           -- 'Pico', 'Valle'
  vigente_desde date NOT NULL DEFAULT CURRENT_DATE,
  vigente_hasta date,
  CHECK (hora_hasta > hora_desde OR hora_hasta = '00:00')
);
CREATE INDEX tarifas_lookup ON tarifas (club_id, cancha_id, dia_semana);

-- -----------------------------------------------------------------------------
-- Clientes (sin cuenta: se identifican por teléfono y/o DNI dentro del club)
-- -----------------------------------------------------------------------------
CREATE TABLE clientes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id        uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  nombre         text NOT NULL,
  telefono_e164  text NOT NULL CHECK (telefono_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  dni            text CHECK (dni ~ '^[0-9]{6,9}$'),
  email          citext,
  saldo_puntos   integer NOT NULL DEFAULT 0 CHECK (saldo_puntos >= 0), -- caché del ledger
  bloqueado      boolean NOT NULL DEFAULT false,                      -- lista negra por ausencias
  notas          text,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (club_id, telefono_e164),
  UNIQUE (club_id, id)
);
CREATE UNIQUE INDEX clientes_dni_uq ON clientes (club_id, dni) WHERE dni IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Configuración de seña y expiración (timer parametrizable)
-- -----------------------------------------------------------------------------
-- Resolución: se toman las reglas activas que matchean (día, hora de inicio del
-- turno, cancha) y gana la de mayor prioridad; a igual prioridad, la más
-- específica (cancha > día > general). Ver docs/arquitectura.md §4.
CREATE TABLE configuracion_expiracion (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id            uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  nombre             text NOT NULL,                       -- 'Fin de semana noche'
  cancha_id          uuid REFERENCES canchas(id) ON DELETE CASCADE,
  dia_semana         smallint CHECK (dia_semana BETWEEN 0 AND 6),  -- NULL = todos
  hora_desde         time,                                -- NULL = todo el día
  hora_hasta         time,
  requiere_sena      boolean NOT NULL,                    -- el ON/OFF
  tipo_sena          tipo_sena NOT NULL DEFAULT 'PORCENTAJE',
  valor_sena         bigint NOT NULL DEFAULT 50 CHECK (valor_sena >= 0), -- % o centavos
  minutos_expiracion integer NOT NULL DEFAULT 30 CHECK (minutos_expiracion BETWEEN 2 AND 2880),
  -- el hold nunca puede vencer después de (inicio del turno - margen)
  margen_min_antes_inicio integer NOT NULL DEFAULT 15 CHECK (margen_min_antes_inicio >= 0),
  prioridad          smallint NOT NULL DEFAULT 0,
  activa             boolean NOT NULL DEFAULT true,
  CHECK ((hora_desde IS NULL) = (hora_hasta IS NULL))
);
CREATE INDEX conf_exp_lookup ON configuracion_expiracion (club_id) WHERE activa;

-- -----------------------------------------------------------------------------
-- Turnos fijos / recurrentes (plantilla que el worker materializa)
-- -----------------------------------------------------------------------------
CREATE TABLE turnos_fijos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id        uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  cancha_id      uuid NOT NULL,
  cliente_id     uuid NOT NULL,
  dia_semana     smallint NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),
  hora_inicio    time NOT NULL,
  duracion_min   smallint NOT NULL CHECK (duracion_min > 0),
  frecuencia_semanas smallint NOT NULL DEFAULT 1 CHECK (frecuencia_semanas IN (1, 2, 4)),
  vigente_desde  date NOT NULL,
  vigente_hasta  date,
  precio_pactado bigint CHECK (precio_pactado >= 0),  -- NULL = usa tarifa
  materializado_hasta date,                          -- hasta qué fecha ya se generaron turnos
  activo         boolean NOT NULL DEFAULT true,
  FOREIGN KEY (club_id, cancha_id)  REFERENCES canchas  (club_id, id),
  FOREIGN KEY (club_id, cliente_id) REFERENCES clientes (club_id, id)
);

-- -----------------------------------------------------------------------------
-- Turnos (reservas) — núcleo del sistema
-- -----------------------------------------------------------------------------
CREATE TABLE turnos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id        uuid NOT NULL,
  cancha_id      uuid NOT NULL,
  cliente_id     uuid,                                 -- NULL solo para origen = BLOQUEO
  turno_fijo_id  uuid REFERENCES turnos_fijos(id) ON DELETE SET NULL,
  inicio         timestamptz NOT NULL,
  fin            timestamptz NOT NULL,
  rango          tstzrange GENERATED ALWAYS AS (tstzrange(inicio, fin, '[)')) STORED,
  estado         estado_turno NOT NULL,
  origen         origen_turno NOT NULL,
  -- importes congelados al momento de reservar (centavos)
  precio_total   bigint NOT NULL DEFAULT 0 CHECK (precio_total >= 0),
  monto_sena     bigint NOT NULL DEFAULT 0 CHECK (monto_sena >= 0),
  -- timer
  expira_en      timestamptz,
  -- check-in: token aleatorio (128 bits) que va dentro del QR firmado
  codigo_checkin text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  checkin_en     timestamptz,
  checkin_por    uuid REFERENCES usuarios(id),
  -- idempotencia: el front manda una clave por intento de reserva
  idempotency_key uuid,
  creado_por     uuid REFERENCES usuarios(id),        -- NULL = reserva pública
  cancelado_en   timestamptz,
  motivo_cancelacion text,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  version        integer NOT NULL DEFAULT 0,           -- bloqueo optimista para ediciones del admin

  FOREIGN KEY (club_id, cancha_id)  REFERENCES canchas  (club_id, id),
  FOREIGN KEY (club_id, cliente_id) REFERENCES clientes (club_id, id),
  CHECK (fin > inicio),
  CHECK ((estado = 'PRE_RESERVADO') = (expira_en IS NOT NULL)),
  CHECK (cliente_id IS NOT NULL OR origen = 'BLOQUEO'),
  CHECK (monto_sena <= precio_total),

  -- ★ ANTI-SOBRERRESERVA: dos turnos "vivos" de la misma cancha no pueden
  --   solaparse. Lo valida el motor de forma atómica (error 23P01).
  CONSTRAINT turnos_sin_solapamiento EXCLUDE USING gist (
    cancha_id WITH =,
    rango     WITH &&
  ) WHERE (estado IN ('PRE_RESERVADO', 'CONFIRMADO', 'PRESENTE', 'AUSENTE'))
);
CREATE UNIQUE INDEX turnos_idempotency_uq ON turnos (club_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX turnos_agenda      ON turnos (club_id, inicio);
CREATE INDEX turnos_cliente     ON turnos (cliente_id, inicio DESC);
CREATE INDEX turnos_por_expirar ON turnos (expira_en) WHERE estado = 'PRE_RESERVADO';

-- -----------------------------------------------------------------------------
-- Pagos
-- -----------------------------------------------------------------------------
CREATE TABLE pagos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id         uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  turno_id        uuid NOT NULL REFERENCES turnos(id),
  proveedor       proveedor_pago NOT NULL,
  concepto        concepto_pago  NOT NULL,
  estado          estado_pago    NOT NULL DEFAULT 'PENDIENTE',
  monto           bigint NOT NULL CHECK (monto > 0),
  external_id     text,               -- payment id de Mercado Pago
  preferencia_id  text,               -- preference id de MP (checkout)
  comprobante_url text,               -- transferencia: archivo subido (S3/R2)
  revisado_por    uuid REFERENCES usuarios(id),
  payload         jsonb,              -- última respuesta del proveedor (auditoría)
  creado_en       timestamptz NOT NULL DEFAULT now(),
  acreditado_en   timestamptz
);
-- Idempotencia de webhooks: el mismo pago de MP nunca se registra dos veces.
CREATE UNIQUE INDEX pagos_external_uq ON pagos (proveedor, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX pagos_turno ON pagos (turno_id);

-- -----------------------------------------------------------------------------
-- Lista de espera
-- -----------------------------------------------------------------------------
CREATE TABLE lista_espera (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id            uuid NOT NULL,
  cliente_id         uuid NOT NULL,
  cancha_id          uuid,                          -- NULL = cualquier cancha que cumpla filtros
  jugadores_por_lado smallint,
  desde              timestamptz NOT NULL,          -- ventana aceptable
  hasta              timestamptz NOT NULL,
  duracion_min       smallint NOT NULL DEFAULT 60,
  estado             estado_espera NOT NULL DEFAULT 'ACTIVA',
  notificada_en      timestamptz,
  oferta_turno_id    uuid REFERENCES turnos(id),    -- hold creado para esta persona
  creado_en          timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (club_id, cliente_id) REFERENCES clientes (club_id, id),
  FOREIGN KEY (club_id, cancha_id)  REFERENCES canchas  (club_id, id),
  CHECK (hasta > desde)
);
CREATE INDEX espera_busqueda ON lista_espera USING gist (club_id, tstzrange(desde, hasta)) WHERE estado = 'ACTIVA';

-- -----------------------------------------------------------------------------
-- Cantina / inventario / consumos
-- -----------------------------------------------------------------------------
CREATE TABLE inventario_cantina (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id     uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  nombre      text NOT NULL,
  categoria   text NOT NULL DEFAULT 'BEBIDA',   -- BEBIDA, COMIDA, ALQUILER (pelota, pecheras)
  precio      bigint NOT NULL CHECK (precio >= 0),
  controla_stock boolean NOT NULL DEFAULT true,  -- los alquileres no descuentan stock
  stock       integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
  stock_minimo integer NOT NULL DEFAULT 0,
  activo      boolean NOT NULL DEFAULT true,
  UNIQUE (club_id, nombre)
);

CREATE TABLE consumos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id         uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  turno_id        uuid NOT NULL REFERENCES turnos(id) ON DELETE CASCADE,
  producto_id     uuid NOT NULL REFERENCES inventario_cantina(id),
  cantidad        integer NOT NULL CHECK (cantidad > 0),
  precio_unitario bigint  NOT NULL CHECK (precio_unitario >= 0),  -- congelado
  cargado_por     uuid REFERENCES usuarios(id),
  creado_en       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consumos_turno ON consumos (turno_id);

-- -----------------------------------------------------------------------------
-- Fidelización
-- -----------------------------------------------------------------------------
CREATE TABLE promociones_puntos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id       uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  nombre        text NOT NULL,                     -- 'Martes valle x2'
  dia_semana    smallint CHECK (dia_semana BETWEEN 0 AND 6),
  hora_desde    time,
  hora_hasta    time,
  multiplicador numeric(4,2) NOT NULL CHECK (multiplicador > 0),
  puntos_extra  integer NOT NULL DEFAULT 0,
  vigente_desde date NOT NULL DEFAULT CURRENT_DATE,
  vigente_hasta date,
  activa        boolean NOT NULL DEFAULT true
);

CREATE TABLE premios (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id      uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  nombre       text NOT NULL,
  descripcion  text,
  costo_puntos integer NOT NULL CHECK (costo_puntos > 0),
  tipo         tipo_premio NOT NULL,
  valor        bigint NOT NULL DEFAULT 0,          -- centavos o % según tipo
  stock        integer,                            -- NULL = ilimitado
  activo       boolean NOT NULL DEFAULT true
);

CREATE TABLE canjes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id      uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  cliente_id   uuid NOT NULL,
  premio_id    uuid NOT NULL REFERENCES premios(id),
  puntos       integer NOT NULL CHECK (puntos > 0),
  codigo       text NOT NULL UNIQUE DEFAULT upper(encode(gen_random_bytes(5), 'hex')),
  estado       estado_canje NOT NULL DEFAULT 'EMITIDO',
  turno_id     uuid REFERENCES turnos(id),          -- dónde se aplicó
  creado_en    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (club_id, cliente_id) REFERENCES clientes (club_id, id)
);

-- Ledger append-only: clientes.saldo_puntos es solo una caché de SUM(puntos).
CREATE TABLE movimientos_puntos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id     uuid NOT NULL,
  cliente_id  uuid NOT NULL,
  tipo        tipo_mov_puntos NOT NULL,
  puntos      integer NOT NULL CHECK (puntos <> 0),   -- negativo en CANJE
  turno_id    uuid REFERENCES turnos(id),
  canje_id    uuid REFERENCES canjes(id),
  promocion_id uuid REFERENCES promociones_puntos(id),
  creado_en   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (club_id, cliente_id) REFERENCES clientes (club_id, id)
);
-- Un partido acumula puntos una sola vez (check-in idempotente).
CREATE UNIQUE INDEX mov_puntos_acum_uq ON movimientos_puntos (turno_id) WHERE tipo = 'ACUMULACION';
CREATE INDEX mov_puntos_cliente ON movimientos_puntos (cliente_id, creado_en DESC);

-- -----------------------------------------------------------------------------
-- Notificaciones (patrón outbox: se escriben en la misma transacción que el
-- cambio de negocio y un worker las despacha con reintentos)
-- -----------------------------------------------------------------------------
CREATE TABLE notificaciones (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id     uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  cliente_id  uuid,
  canal       canal_notif NOT NULL,
  destino     text NOT NULL,
  plantilla   text NOT NULL,              -- 'reserva_confirmada', 'turno_liberado', …
  payload     jsonb NOT NULL DEFAULT '{}',
  estado      estado_notif NOT NULL DEFAULT 'PENDIENTE',
  intentos    smallint NOT NULL DEFAULT 0,
  proximo_intento timestamptz NOT NULL DEFAULT now(),
  error       text,
  creado_en   timestamptz NOT NULL DEFAULT now(),
  enviada_en  timestamptz
);
CREATE INDEX notif_pendientes ON notificaciones (proximo_intento) WHERE estado = 'PENDIENTE';

-- -----------------------------------------------------------------------------
-- Auditoría de cambios de estado de turnos (quién / cuándo / por qué)
-- -----------------------------------------------------------------------------
CREATE TABLE turnos_eventos (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  turno_id   uuid NOT NULL REFERENCES turnos(id) ON DELETE CASCADE,
  de_estado  estado_turno,
  a_estado   estado_turno NOT NULL,
  actor      text NOT NULL,              -- 'usuario:<uuid>', 'cliente', 'worker', 'webhook:mp'
  detalle    jsonb,
  creado_en  timestamptz NOT NULL DEFAULT now()
);

-- Triggers: updated_at + version (BEFORE) y auditoría + aviso en tiempo real
-- vía LISTEN/NOTIFY (AFTER, cuando la fila ya existe para la FK del evento).
CREATE FUNCTION turnos_before_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.actualizado_en := now();
  NEW.version := OLD.version + 1;
  RETURN NEW;
END $$;

CREATE FUNCTION turnos_after_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.estado IS DISTINCT FROM OLD.estado THEN
    INSERT INTO turnos_eventos (turno_id, de_estado, a_estado, actor)
    VALUES (NEW.id,
            CASE WHEN TG_OP = 'UPDATE' THEN OLD.estado END,
            NEW.estado,
            coalesce(nullif(current_setting('app.actor', true), ''), 'desconocido'));
  END IF;
  -- payload chico: el front invalida la grilla del club/cancha y la vuelve a pedir.
  -- pg_notify es transaccional: solo se emite si la transacción hace COMMIT.
  PERFORM pg_notify('turnos', json_build_object(
    'club_id', NEW.club_id, 'cancha_id', NEW.cancha_id,
    'inicio', NEW.inicio, 'estado', NEW.estado)::text);
  RETURN NULL;
END $$;

CREATE TRIGGER turnos_version BEFORE UPDATE ON turnos
  FOR EACH ROW EXECUTE FUNCTION turnos_before_update();
CREATE TRIGGER turnos_cambios AFTER INSERT OR UPDATE ON turnos
  FOR EACH ROW EXECUTE FUNCTION turnos_after_change();
