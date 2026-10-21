import type { CategoriaProducto, MedioCantina } from '@/lib/tipos';

export const CATEGORIAS: Record<CategoriaProducto, string> = {
  BEBIDA: 'Bebidas',
  COMIDA: 'Comida',
  ALQUILER: 'Alquileres',
  OTRO: 'Otros',
};

export const MEDIOS: Record<MedioCantina, string> = {
  EFECTIVO: 'Efectivo',
  TRANSFERENCIA: 'Transferencia',
  MERCADO_PAGO: 'Mercado Pago',
  OTRO: 'Otro (posnet…)',
};
