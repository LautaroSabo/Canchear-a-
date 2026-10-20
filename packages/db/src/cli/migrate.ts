import { urlDesdeEntorno } from '../client.ts';
import { migrar } from '../migrador.ts';
import { ejecutar } from './ejecutar.ts';

await ejecutar(() => migrar(urlDesdeEntorno()));
