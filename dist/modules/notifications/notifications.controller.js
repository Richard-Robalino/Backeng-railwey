import { sendEmail } from '../../utils/email.js';
import { NotificationModel } from '../../models/Notification.js';
export async function sendTestEmail(req, res, next) {
    try {
        const { to, subject, message } = req.body;
        await sendEmail(to, subject, message);
        await NotificationModel.create({ userId: req.user.id, type: 'EMAIL', title: subject, message, sentAt: new Date() });
        res.json({ ok: true });
    }
    catch (err) {
        next(err);
    }
}
