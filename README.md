# Lina Hernández Peluquería — Backend (Node + TypeScript + Express + Mongoose)

API REST segura y escalable para gestionar usuarios (administrador, gerente, estilista y cliente), servicios, agendas, reservas, calificaciones, notificaciones y reportes. Incluye autenticación por JWT, sesiones con inactividad de 20 minutos, bloqueo por intentos fallidos, recuperación de contraseña con OTP, e inicio de sesión con Google (exclusivo para clientes).

## Quick Start

```bash
# 1) Clonar y entrar
npm install

# 2) Variables de entorno
cp .env.example .env
# Edita MONGO_URI, GOOGLE_CLIENT_ID y SMTP_*

# 3) Desarrollo
npm run dev

# 4) Producción
npm run build && npm start
```

- Base URL: `/api/v1`
- Documentación rápida de rutas en `src/routes.ts`.
- Roles: `ADMIN`, `GERENTE`, `ESTILISTA`, `CLIENTE`.
- Política de seguridad:
  - CORS restringido por `CLIENT_ORIGINS`
  - Helmet, HPP, mongo-sanitize, rate limiting
  - Políticas de contraseña y bloqueo por intentos (5 → 15 min)
  - Inactividad 20 min por sesión
  - JWT access (15 min) + refresh (7 días) con rotación y revocación por sesión

> **Nota:** Para desarrollo local puedes usar una cuenta SMTP de [Ethereal Email](https://ethereal.email/) para probar el envío de correos sin costo.

## Estructura

```
src/
  app.ts, server.ts, routes.ts
  config/         # env, db, logger
  constants/      # roles, estados
  middlewares/    # auth, errores, rate limit, validate
  models/         # User, Session, Service, Booking, Rating, Payment, etc.
  modules/        # auth, users(admin), services, stylists, schedules, bookings, ratings, reports, notifications
  utils/          # tokens, email, password, time, profanity
  types/          # extensiones de Express
```

## Reglas de negocio implementadas (resumen)

- Registro solo para **clientes**; estilistas/gerentes/admin los crea admin/gerente.
- **Google Sign-In** (solo clientes): crea o inicia sesión con rol CLIENTE.
- Inicio/cierre de sesión con **tokens** y **revocación por sesión**.
- **Bloqueo** por 5 intentos fallidos durante 15 min.
- **Inactividad**: sesión expira a los 20 min sin actividad.
- Recuperación de contraseña con **OTP** (15 min) y **reenvío** cada 90 s.
- Reservas: crear, reprogramar, cancelar. **No reprogramar/cancelar** con menos de **12 horas** de anticipación (cliente).
- Evitar **doble reserva** en el mismo horario (cliente/estilista).
- Estilista espera **10 minutos** y puede marcar *no-show* o cancelar con motivo.
- Calificación 1–5 estrellas, comentario ≤ 70 caracteres con filtro básico.
- Reportes: servicios más solicitados, calificaciones por estilista, citas finalizadas/canceladas, ingreso mensual.
- Horarios de atención del negocio y disponibilidad de estilistas con excepciones.

## Licencia

Uso académico.
