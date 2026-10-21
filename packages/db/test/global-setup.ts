import type { TestProject } from 'vitest/node';
import { crearBaseDeTest } from '../src/testing.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

export default async function setup(project: TestProject) {
  const { url, borrar } = await crearBaseDeTest();
  project.provide('databaseUrl', url);
  return borrar;
}
