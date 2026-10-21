import { normalizarTelefono } from '@cancheria/core';
import { violaUnique } from '@cancheria/db';
import { clientes } from '@cancheria/db/schema';
import { sql } from 'drizzle-orm';
import type { Ejecutor } from './entorno.ts';
import { ErrorNegocio } from './errores.ts';

export interface DatosCliente {
  nombre: string;
  telefono: string;
  dni?: string | undefined;
  email?: string | undefined;
}

export function telefonoValido(telefono: string): string {
  const e164 = normalizarTelefono(telefono);
  if (!e164) throw new ErrorNegocio(422, 'TELEFONO_INVALIDO', 'Revisá el número de teléfono / WhatsApp');
  return e164;
}

/**
 * Alta o búsqueda del cliente por teléfono dentro del club. Si ya existe no se pisa el
 * nombre (alguien podría escribir el teléfono de otro); solo se completan DNI y email.
 * Se llama dentro de la transacción de la operación (reserva, lista de espera).
 */
export async function upsertCliente(tx: Ejecutor, clubId: string, datos: DatosCliente) {
  const telefono = telefonoValido(datos.telefono);
  try {
    const [cliente] = await tx
      .insert(clientes)
      .values({
        clubId,
        nombre: datos.nombre,
        telefonoE164: telefono,
        dni: datos.dni ?? null,
        email: datos.email ?? null,
      })
      .onConflictDoUpdate({
        target: [clientes.clubId, clientes.telefonoE164],
        set: {
          dni: sql`coalesce(${clientes.dni}, excluded.dni)`,
          email: sql`coalesce(${clientes.email}, excluded.email)`,
        },
      })
      .returning({ id: clientes.id, nombre: clientes.nombre, bloqueado: clientes.bloqueado });
    if (!cliente) throw new Error('upsert de cliente sin filas');
    if (cliente.bloqueado) {
      throw new ErrorNegocio(403, 'CLIENTE_BLOQUEADO', 'No podés reservar online: comunicate con el club');
    }
    return cliente;
  } catch (e) {
    if (violaUnique(e, 'clientes_dni_uq')) {
      throw new ErrorNegocio(
        409,
        'DNI_CON_OTRO_TELEFONO',
        'Ese DNI ya está registrado con otro teléfono. Usá el teléfono con el que reservaste antes.',
      );
    }
    throw e;
  }
}
