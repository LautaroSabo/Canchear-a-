import { urlDesdeEntorno } from '../client.ts';
import { sembrar } from '../seed.ts';
import { ejecutar } from './ejecutar.ts';

await ejecutar(() => sembrar(urlDesdeEntorno()));
