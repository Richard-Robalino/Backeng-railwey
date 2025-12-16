import 'dotenv/config';
import { connect } from './config/db.js';
import app from './app.js';
import { env } from './config/env.js';
import { startAppointmentReminderJob } from './jobs/reminders.js';
import { verifyEmailTransport } from './utils/email.js';
import 'dotenv/config';
process.env.TZ = process.env.TZ || process.env.APP_TZ || 'America/Guayaquil';
async function bootstrap() {
    await connect();
    try {
        await verifyEmailTransport();
    }
    catch (e) {
        console.error("Email transport not ready:", e);
    }
    const port = Number(process.env.PORT) || env.PORT || 3000;
    const server = app.listen(port, () => {
        console.log(`API listening on http://localhost:${port}`);
        startAppointmentReminderJob();
    });
    process.on('SIGINT', () => server.close(() => process.exit(0)));
    process.on('SIGTERM', () => server.close(() => process.exit(0)));
}
bootstrap().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
verifyEmailTransport();
