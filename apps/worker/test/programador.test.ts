import { describe, expect, it } from 'vitest';
import { Programador } from '../src/programador.ts';

const silencioso = { debug: () => {}, error: () => {} };
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Programador', () => {
  it('nunca solapa una tarea consigo misma, aunque tarde más que su intervalo', async () => {
    let enCurso = 0;
    let maximo = 0;
    let corridas = 0;
    const p = new Programador(
      [
        {
          nombre: 'lenta',
          cadaMs: 1,
          ejecutar: async () => {
            enCurso++;
            maximo = Math.max(maximo, enCurso);
            await esperar(15);
            enCurso--;
            corridas++;
          },
        },
      ],
      silencioso,
    );
    p.iniciar();
    await esperar(80);
    await p.detener();
    expect(maximo).toBe(1);
    expect(corridas).toBeGreaterThan(1);
  });

  it('un error no mata la tarea: se loguea y sigue en la próxima vuelta', async () => {
    const errores: unknown[] = [];
    let corridas = 0;
    const p = new Programador(
      [
        {
          nombre: 'falla',
          cadaMs: 1,
          ejecutar: async () => {
            corridas++;
            throw new Error('boom');
          },
        },
      ],
      { debug: () => {}, error: (o) => errores.push(o) },
    );
    p.iniciar();
    await esperar(30);
    await p.detener();
    expect(corridas).toBeGreaterThan(1);
    expect(errores.length).toBe(corridas);
  });

  it('detener() espera a que termine la corrida en curso y no arranca otra', async () => {
    let terminadas = 0;
    let iniciadas = 0;
    const p = new Programador(
      [
        {
          nombre: 'larga',
          cadaMs: 1,
          ejecutar: async () => {
            iniciadas++;
            await esperar(40);
            terminadas++;
          },
        },
      ],
      silencioso,
    );
    p.iniciar();
    await esperar(5);
    await p.detener();
    expect(terminadas).toBe(iniciadas);
    await esperar(20);
    expect(iniciadas).toBe(1);
  });
});
