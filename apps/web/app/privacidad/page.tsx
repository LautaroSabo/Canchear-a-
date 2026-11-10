import type { Metadata } from 'next';
import { contacto, PaginaLegal, TITULAR } from '@/componentes/legal/PaginaLegal';

export const metadata: Metadata = {
  title: 'Política de privacidad',
  description: 'Qué datos guarda Canchería, para qué y cómo ejercer tus derechos.',
};

export default function Privacidad() {
  return (
    <PaginaLegal titulo="Política de privacidad">
      <p>
        Esta política explica qué datos personales se guardan en Canchería, para qué se usan y cómo podés
        acceder a ellos, corregirlos o pedir que se borren, según la Ley 25.326 de Protección de los Datos
        Personales.
      </p>

      <h2>1. Quién es responsable</h2>
      <ul>
        <li>
          <strong>Si reservás, te anotás en una lista de espera o inscribís un equipo:</strong> el responsable
          de tus datos es el club donde lo hacés. Canchería ({TITULAR}) los guarda y procesa por cuenta del
          club, solo para prestarle el servicio.
        </li>
        <li>
          <strong>Si registrás un club o tenés usuario en el panel:</strong> el responsable de los datos de tu
          cuenta es {TITULAR}.
        </li>
      </ul>

      <h2>2. Qué datos guardamos</h2>
      <ul>
        <li>
          <strong>Jugadores:</strong> nombre, teléfono, y si los dejás, email y DNI (el DNI es opcional y
          sirve para sumar puntos). También las reservas, pagos, asistencias y puntos de cada club, y el
          comprobante de transferencia si pagás así.
        </li>
        <li>
          <strong>Equipos de torneos:</strong> nombre del equipo, del delegado y su teléfono. El teléfono no
          se publica: solo lo ve el club.
        </li>
        <li>
          <strong>Clubes y su personal:</strong> nombre, email y contraseña (guardada cifrada de forma
          irreversible), datos del club y las credenciales de Mercado Pago (cifradas).
        </li>
        <li>
          <strong>Datos técnicos:</strong> dirección IP y registros de seguridad (por ejemplo, intentos de
          ingreso), y errores técnicos para poder corregirlos. El panel usa una cookie de sesión; la página
          pública no usa cookies de seguimiento ni publicidad. El navegador puede recordar preferencias como
          "mi equipo" en tu propio dispositivo.
        </li>
      </ul>
      <p>No es obligatorio dar los datos opcionales. Sin nombre y teléfono no se puede tomar una reserva.</p>

      <h2>3. Para qué los usamos</h2>
      <ul>
        <li>Tomar y administrar la reserva, la seña, las devoluciones y el ingreso al club (código QR).</li>
        <li>
          Mandarte avisos de tu turno por email (confirmación, cambios, cancelaciones) y, si te anotaste en la
          lista de espera, por WhatsApp cuando se libera un lugar.
        </li>
        <li>Los puntos y premios del club, si el club los usa.</li>
        <li>La seguridad del servicio, prevenir fraudes y dar soporte.</li>
      </ul>
      <p>No vendemos tus datos ni los usamos para publicidad de terceros.</p>

      <h2>4. Con quién se comparten</h2>
      <ul>
        <li>Con el club donde reservaste: ve tus datos para gestionar el turno.</li>
        <li>
          Con proveedores que hacen funcionar el servicio, solo en lo necesario: alojamiento y base de datos
          (Railway), pagos (Mercado Pago), envío de emails (Resend), WhatsApp (Meta), registro de errores
          (Sentry) y copias de seguridad cifradas (GitHub).
        </li>
        <li>Con autoridades, cuando una ley u orden judicial lo exija.</li>
      </ul>
      <p>
        Algunos de estos proveedores tienen sus servidores fuera de la Argentina. Se eligen proveedores que
        protegen los datos con medidas adecuadas.
      </p>

      <h2>5. Cuánto tiempo</h2>
      <p>
        Los datos de reservas se guardan mientras el club use la plataforma, para su historial y sus
        obligaciones contables. Los registros técnicos y las copias de seguridad se borran solos después de un
        tiempo (las copias, a los 30 días). Si pedís que se borren tus datos, se eliminan o se anonimizan,
        salvo lo que haya que conservar por ley.
      </p>

      <h2>6. Seguridad</h2>
      <p>
        Las conexiones van cifradas (HTTPS), las contraseñas y credenciales se guardan cifradas, cada club ve
        solo sus datos y los links de los comprobantes usan códigos imposibles de adivinar.
      </p>

      <h2>7. Tus derechos</h2>
      <p>
        Podés pedir acceso a tus datos, corregirlos, actualizarlos o pedir que se borren. Escribile al club
        donde reservaste o a {contacto()}. Te respondemos dentro de los plazos de la ley (10 días corridos
        para el acceso y 5 días hábiles para corregir o borrar).
      </p>
      <p className="text-sm text-tenue">
        El titular de los datos personales tiene la facultad de ejercer el derecho de acceso a los mismos en
        forma gratuita a intervalos no inferiores a seis meses, salvo que se acredite un interés legítimo al
        efecto conforme lo establecido en el artículo 14, inciso 3 de la Ley Nº 25.326. La AGENCIA DE ACCESO A
        LA INFORMACIÓN PÚBLICA, en su carácter de Órgano de Control de la Ley Nº 25.326, tiene la atribución
        de atender las denuncias y reclamos que interpongan quienes resulten afectados en sus derechos por
        incumplimiento de las normas vigentes en materia de protección de datos personales.
      </p>

      <h2>8. Menores</h2>
      <p>
        Para reservar o registrar un club hay que ser mayor de edad o contar con autorización de un adulto
        responsable.
      </p>

      <h2>9. Cambios</h2>
      <p>
        Si cambiamos esta política, se actualiza la fecha de arriba y, si el cambio es importante, se avisa en
        la plataforma.
      </p>
    </PaginaLegal>
  );
}
