# Seguridad

Qué protege la app, cómo está verificado y qué queda por hacer.

## Lo que está protegido

| Riesgo | Cómo se cubre | Verificado en |
|---|---|---|
| Contraseñas robadas de la base | Se guardan con scrypt (hash lento con sal), nunca en texto | `servicios/test/auth.test.ts` |
| Robo de sesión | Cookie `httpOnly` (el JavaScript de la página no la puede leer), `Secure` con HTTPS, `SameSite=Lax`, limitada a `/admin`. En la base se guarda el hash del token, no el token | `api/test/admin.test.ts` |
| CSRF (otro sitio que manda acciones en nombre del usuario) | Todo lo que modifica algo exige el header `x-cancheria-csrf`. CORS solo acepta el origen de la web | `api/test/admin.test.ts` |
| Adivinar contraseñas | 10 intentos por minuto por IP, y la cuenta se frena 15 minutos tras 10 fallas, vengan de donde vengan. Mismo mensaje exista o no el email | `api/test/seguridad.test.ts` |
| Saltear el límite por IP falseando `X-Forwarded-For` | Solo se confía en la IP que agrega el proxy del hosting (`PROXIES_CONFIABLES`) | `api/test/seguridad.test.ts` |
| Un club que ve o toca datos de otro | Cada ruta del panel exige ser miembro del club, y cada consulta filtra por el club de la URL. Con IDs de otro club todo responde "no encontrado" | `api/test/aislamiento.test.ts` (17 operaciones) |
| Permisos dentro del club | Roles Dueño > Administración > Recepción por ruta. La administración de la plataforma es solo para el superadmin; para el resto, no existe (404) | `api/test/admin.test.ts`, `plataforma.test.ts` |
| Inyección SQL | Todas las consultas van parametrizadas (Drizzle) | revisión de código |
| XSS (código inyectado en la página) | React escapa todo el texto. El único HTML directo es el QR, que genera la app | revisión de código |
| Archivos maliciosos como comprobante | Se valida el contenido real (JPG, PNG, WEBP o PDF), hasta 5 MB. Solo los ve el personal del club, con `nosniff` | `api/test/pagos.test.ts` |
| Pagos falsos de Mercado Pago | El webhook verifica la firma de MP y además le pregunta a MP el estado real del pago. Un mismo pago no se procesa dos veces | `api/test/pagos.test.ts` |
| Credenciales de Mercado Pago de los clubes | Cifradas con AES-256-GCM (`CLAVE_CREDENCIALES`), nunca se devuelven al navegador | revisión de código |
| Comprobantes de reserva | El link usa un código de 128 bits imposible de adivinar, y la página no se indexa | revisión de código |
| Reservas en masa | 10 reservas por minuto por IP. El turno se bloquea en la base y nunca se reserva dos veces | `api/test/reservas.test.ts` (30 a la vez) |
| Clickjacking, sniffing, referer | Encabezados `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` y HSTS en la web y la API | `api/test/seguridad.test.ts` |
| Librerías con fallas conocidas | `pnpm audit`: sin vulnerabilidades conocidas | correr `pnpm audit` |

## Al publicar

- **`CLAVE_CREDENCIALES`**: generala nueva (nunca uses la de `.env.example`) y guardala
  fuera del servidor. Si se filtra, alguien con acceso a la base podría leer los tokens de
  Mercado Pago de los clubes.
- **Usuario de la base:** no compartas la URL pública de Postgres. Usala solo para los
  comandos `pnpm superadmin`, `club:crear` y `usuario:contrasena`.
- **Backups:** activá los backups automáticos del Postgres de Railway.
- **Tu cuenta de superadmin:** usá una contraseña larga y única, y no la compartas: da
  acceso a todos los clubes.
- **Railway y GitHub:** activá la verificación en dos pasos en las dos cuentas. Quien
  entre ahí controla todo.

## Si alguien se olvida la contraseña

- **Por mail:** en el login, *¿Olvidaste tu contraseña?* manda un link de un solo uso que
  vence en 1 hora. Responde lo mismo exista o no la cuenta. Necesita el aviso por mail
  configurado (`RESEND_API_KEY`). Con Resend sin dominio verificado, solo llegan los mails
  a la dirección de tu cuenta de Resend: para los clubes, verificá tu dominio en Resend.
- **Por WhatsApp (sin depender del mail):** en *Administrar plataforma*, en el club,
  *Contraseña del dueño → Generar link*, y mandáselo.
- **Por consola:** `pnpm usuario:contrasena <email>`.

Al elegir la contraseña nueva se cierran todas las sesiones abiertas de esa cuenta.

## Pendiente

- **Verificación en dos pasos** para dueños y superadmin.
- **Captcha en el registro de clubes.** Hoy lo frenan el límite de 5 por minuto por IP y
  la aprobación manual: un registro falso no publica nada.
- **Content-Security-Policy** estricta en la web.
- **Prueba de penetración externa** antes de crecer a muchos clubes.
