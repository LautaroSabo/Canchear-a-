import { crearBaseDeTest } from '@cancheria/db/testing';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

export default async function setup(project: TestProject) {
  const { url, borrar } = await crearBaseDeTest('cancheria_api_test');
  project.provide('databaseUrl', url);
  return borrar;
}
