import { type CountryCode, parsePhoneNumberFromString } from 'libphonenumber-js/min';

/**
 * Normaliza a E.164. En Argentina el mismo celular se escribe con o sin el 9
 * ("11 5555-1234" vs "+54 9 11 5555-1234") y libphonenumber los devuelve distinto; como
 * el teléfono identifica al cliente (y es su WhatsApp), se fuerza siempre el formato móvil
 * +549…, el que usa WhatsApp. Devuelve null si el número no es válido.
 */
export function normalizarTelefono(entrada: string, paisPorDefecto: CountryCode = 'AR'): string | null {
  const numero = parsePhoneNumberFromString(entrada.trim(), paisPorDefecto);
  if (!numero?.isValid()) return null;
  if (numero.countryCallingCode === '54' && numero.nationalNumber.length === 10) {
    return `+549${numero.nationalNumber}`;
  }
  return numero.number;
}
