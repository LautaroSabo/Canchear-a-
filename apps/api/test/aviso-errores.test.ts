import { ErrorNegocio } from '@cancheria/servicios';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { crearManejadorErrores } from '../src/errores.ts';

describe('aviso de errores de la API', () => {
  it('avisa los 500 con la ruta (sin datos) y no los errores de negocio ni de validación', async () => {
    const avisos: { err: unknown; contexto: Record<string, unknown> | undefined }[] = [];
    const app = Fastify();
    app.setErrorHandler(
      crearManejadorErrores({
        capturar: (err, contexto) => avisos.push({ err, contexto }),
        cerrar: async () => {},
      }),
    );
    app.get('/reservas/:codigo', async () => {
      throw new Error('se cayó la base');
    });
    app.get('/ocupado', async () => {
      throw new ErrorNegocio(409, 'TURNO_OCUPADO', 'Ese turno se acaba de ocupar');
    });
    app.get('/falla-negocio', async () => {
      throw new ErrorNegocio(502, 'MP_CAIDO', 'Mercado Pago no responde');
    });

    expect((await app.inject('/reservas/abc123secreto')).statusCode).toBe(500);
    expect((await app.inject('/ocupado')).statusCode).toBe(409);
    expect((await app.inject('/falla-negocio')).statusCode).toBe(502);
    expect(avisos).toHaveLength(2);
    expect(avisos[0]?.contexto).toEqual({ metodo: 'GET', ruta: '/reservas/:codigo' });
    expect(JSON.stringify(avisos[0]?.contexto)).not.toContain('abc123secreto');
    expect(avisos[1]?.err).toMatchObject({ codigo: 'MP_CAIDO' });
    await app.close();
  });
});
