import type { Metadata } from 'next';
import Link from 'next/link';
import { contacto, PaginaLegal, TITULAR } from '@/componentes/legal/PaginaLegal';

export const metadata: Metadata = {
  title: 'Términos y condiciones',
  description: 'Condiciones de uso de Canchería para jugadores y clubes.',
};

export default function Terminos() {
  return (
    <PaginaLegal titulo="Términos y condiciones">
      <p>
        Estos términos regulan el uso de Canchería, la plataforma que opera {TITULAR} para que los clubes
        publiquen sus canchas y la gente reserve turnos, pague señas y siga torneos. Al reservar, inscribir un
        equipo o registrar un club, aceptás estos términos y la{' '}
        <Link href="/privacidad" className="font-semibold underline">
          Política de privacidad
        </Link>
        .
      </p>

      <h2>1. Qué hace Canchería y qué no</h2>
      <ul>
        <li>
          Canchería es una herramienta: muestra la disponibilidad que carga cada club, toma la reserva y
          registra los pagos. <strong>El turno lo presta el club</strong>, que es quien fija precios,
          horarios, señas y reglas de su cancha y responde por el servicio.
        </li>
        <li>
          Canchería no es parte del acuerdo entre el jugador y el club, salvo en lo que hace a su propio
          funcionamiento como plataforma.
        </li>
      </ul>

      <h2>2. Reservas</h2>
      <ul>
        <li>
          Tenés que dar datos reales (nombre y un teléfono donde te encuentren). La reserva queda a tu nombre.
        </li>
        <li>
          Si el club pide seña, el turno queda apartado por unos minutos: si no se paga en ese tiempo, se
          libera solo. Con seña pagada por transferencia, el club la revisa antes de confirmarla.
        </li>
        <li>
          <strong>Cancelaciones:</strong> cada club define hasta cuántas horas antes se puede cancelar online.
          Dentro de ese plazo, la seña se devuelve por el mismo medio de pago. Pasado el plazo, la cancelación
          y la devolución dependen del club: el comprobante muestra cómo contactarlo.
        </li>
        <li>
          El club puede cancelar un turno (por lluvia, mantenimiento u otro motivo); en ese caso te devuelve
          la seña.
        </li>
        <li>
          El link del comprobante es personal: quien lo tenga puede ver la reserva y cancelarla. Para pasarle
          el dato al grupo usá el botón de compartir, que manda un link sin esas opciones.
        </li>
      </ul>

      <h2>3. Pagos</h2>
      <ul>
        <li>
          Los pagos con tarjeta o dinero en cuenta los procesa <strong>Mercado Pago</strong> en la cuenta del
          club, bajo sus propias condiciones. Canchería no ve ni guarda los datos de tu tarjeta.
        </li>
        <li>Las transferencias van directo a la cuenta del club. El saldo del turno se paga en el club.</li>
      </ul>

      <h2>4. Torneos</h2>
      <p>
        Los torneos los organiza cada club. Al inscribir un equipo, el club puede aprobar o rechazar la
        inscripción, y es quien fija el reglamento, los horarios y los resultados que se publican.
      </p>

      <h2>5. Clubes</h2>
      <ul>
        <li>
          Al registrar un club declarás que podés representarlo y que los datos que cargás (canchas, precios,
          horarios, medios de pago) son correctos. El club responde ante sus clientes por lo que publica y
          cobra, y por sus obligaciones impositivas.
        </li>
        <li>
          Las cuentas nuevas quedan pendientes hasta que se aprueban. El uso tiene un abono mensual, que se
          informa en el panel. Si el abono no se paga o la cuenta se usa en forma indebida, el club puede
          suspenderse: su página se sigue viendo pero no toma reservas nuevas.
        </li>
        <li>
          Respecto de los datos de sus clientes, el club es el responsable y Canchería los trata por cuenta
          del club (ver la Política de privacidad). El club se compromete a usarlos solo para gestionar sus
          turnos y a respetar la Ley 25.326.
        </li>
        <li>Cada usuario cuida su contraseña y responde por lo que se haga desde su cuenta.</li>
      </ul>

      <h2>6. Uso permitido</h2>
      <p>
        No se permite hacer reservas falsas, usar datos de otra persona, intentar acceder a cuentas o
        información ajenas, sobrecargar el servicio ni usarlo para fines ilícitos. Ante estos casos se pueden
        cancelar reservas o bloquear el acceso.
      </p>

      <h2>7. Disponibilidad y responsabilidad</h2>
      <p>
        Hacemos lo posible para que el servicio funcione siempre y los datos estén resguardados (con copias de
        seguridad diarias), pero puede haber interrupciones o errores. En la medida que permita la ley,
        Canchería no responde por daños indirectos ni por lo que dependa del club o de terceros (como Mercado
        Pago o los servicios de mensajería). Nada de esto limita los derechos que te da la Ley 24.240 de
        Defensa del Consumidor.
      </p>

      <h2>8. Cambios</h2>
      <p>
        Si cambiamos estos términos, se actualiza la fecha de arriba y, si el cambio es importante, se avisa
        en la plataforma. Las reservas ya hechas siguen con las condiciones que tenían.
      </p>

      <h2>9. Ley aplicable y contacto</h2>
      <p>
        Estos términos se rigen por las leyes de la República Argentina. Consultas o reclamos sobre la
        plataforma: {contacto()}. Para algo de un turno en particular, escribile primero al club.
      </p>
    </PaginaLegal>
  );
}
