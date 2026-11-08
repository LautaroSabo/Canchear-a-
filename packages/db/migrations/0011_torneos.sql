-- =============================================================================
-- 0011 — Torneos y ligas: equipos, grupos, fixture con horarios y eliminación
-- =============================================================================

-- Formato: `cantidad_grupos` zonas todos contra todos; si `clasifican_por_grupo` > 0,
-- los mejores pasan a un cuadro de eliminación. 1 grupo y 0 clasificados = una liga.
-- Programación: días (0 = domingo), franja horaria y canchas donde la app agenda los
-- partidos, desde `fecha_inicio`, cada uno de `duracion_min`.
CREATE TABLE torneos (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id               uuid NOT NULL REFERENCES clubs(id),
  nombre                text NOT NULL,
  slug                  citext NOT NULL,
  descripcion           text,
  jugadores_por_lado    smallint NOT NULL DEFAULT 5 CHECK (jugadores_por_lado BETWEEN 3 AND 11),
  estado                text NOT NULL DEFAULT 'INSCRIPCION'
                          CHECK (estado IN ('INSCRIPCION', 'EN_CURSO', 'FINALIZADO')),
  inscripcion_online    boolean NOT NULL DEFAULT false,
  cantidad_grupos       smallint NOT NULL DEFAULT 1 CHECK (cantidad_grupos BETWEEN 1 AND 16),
  ida_y_vuelta          boolean NOT NULL DEFAULT false,
  clasifican_por_grupo  smallint NOT NULL DEFAULT 0 CHECK (clasifican_por_grupo BETWEEN 0 AND 8),
  puntos_victoria       smallint NOT NULL DEFAULT 3,
  puntos_empate         smallint NOT NULL DEFAULT 1,
  dias                  smallint[] NOT NULL DEFAULT '{}',
  hora_desde            time,
  hora_hasta            time,
  cancha_ids            uuid[] NOT NULL DEFAULT '{}',
  fecha_inicio          date,
  duracion_min          smallint NOT NULL DEFAULT 60 CHECK (duracion_min BETWEEN 20 AND 240),
  creado_en             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (club_id, slug)
);

-- PENDIENTE: se anotó online y espera al club. Los APROBADO juegan.
CREATE TABLE torneo_equipos (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  torneo_id          uuid NOT NULL REFERENCES torneos(id) ON DELETE CASCADE,
  nombre             citext NOT NULL,
  delegado_nombre    text NOT NULL,
  delegado_telefono  text NOT NULL,
  estado             text NOT NULL DEFAULT 'APROBADO' CHECK (estado IN ('PENDIENTE', 'APROBADO', 'RECHAZADO')),
  grupo              smallint,
  creado_en          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (torneo_id, nombre)
);

-- En la eliminación, el ganador de (ronda, orden) pasa a (ronda / 2, orden / 2): de
-- local si orden es par, de visitante si es impar. Ronda = cantidad de partidos (1 = final).
-- Cada partido programado ocupa un bloqueo en la agenda (turno_id).
CREATE TABLE torneo_partidos (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  torneo_id          uuid NOT NULL REFERENCES torneos(id) ON DELETE CASCADE,
  fase               text NOT NULL CHECK (fase IN ('GRUPOS', 'ELIMINACION')),
  grupo              smallint,
  fecha              smallint,
  ronda              smallint,
  orden              smallint,
  local_id           uuid REFERENCES torneo_equipos(id),
  visitante_id       uuid REFERENCES torneo_equipos(id),
  cancha_id          uuid REFERENCES canchas(id),
  inicio             timestamptz,
  fin                timestamptz,
  turno_id           uuid REFERENCES turnos(id),
  goles_local        smallint CHECK (goles_local >= 0),
  goles_visitante    smallint CHECK (goles_visitante >= 0),
  penales_local      smallint CHECK (penales_local >= 0),
  penales_visitante  smallint CHECK (penales_visitante >= 0),
  ganador_id         uuid REFERENCES torneo_equipos(id),
  estado             text NOT NULL DEFAULT 'PROGRAMADO' CHECK (estado IN ('PROGRAMADO', 'JUGADO')),
  creado_en          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX torneo_partidos_torneo ON torneo_partidos (torneo_id, fase, fecha, ronda, orden);
CREATE UNIQUE INDEX torneo_partidos_llave ON torneo_partidos (torneo_id, ronda, orden) WHERE fase = 'ELIMINACION';
