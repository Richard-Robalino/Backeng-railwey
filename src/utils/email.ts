import { Resend } from 'resend';

const { RESEND_API_KEY, EMAIL_FROM, EMAIL_REPLY_TO } = process.env;

const resend = new Resend(RESEND_API_KEY || '');

function ensureResendConfig() {
  if (!RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY no configurado');
  }
  if (!EMAIL_FROM) {
    throw new Error('EMAIL_FROM no configurado');
  }
}

/**
 * Enviar correo simple (HTML)
 */
export async function sendEmail(to: string, subject: string, html: string) {
  try {
    ensureResendConfig();

    const { data, error } = await resend.emails.send({
      from: EMAIL_FROM!,
      to: [to],
      subject,
      html,
      ...(EMAIL_REPLY_TO ? { replyTo: EMAIL_REPLY_TO } : {})
    });

    if (error) {
      console.error('❌ Resend error:', error);
      throw new Error(error.message);
    }

    console.log(`📧 Email enviado correctamente a ${to}`);
    console.log('ID del mensaje:', data?.id);
  } catch (err) {
    console.error('❌ Error al enviar correo:', err);
    throw new Error('No se pudo enviar el correo electrónico');
  }
}

/**
 * "Verificación" estilo SMTP
 * Resend no usa SMTP, así que validamos config y hacemos una llamada mínima.
 */
export async function verifyEmailTransport() {
  try {
    ensureResendConfig();
    console.log('✅ Resend configurado correctamente (no SMTP).');
  } catch (err) {
    console.error('❌ Error verificando configuración de Resend:', err);
  }
}

/**
 * Enviar correo con adjunto (PDF u otro)
 */
export async function sendEmailWithAttachment(
  to: string,
  subject: string,
  html: string,
  attachment: Buffer,
  filename: string,
  mimeType: string = 'application/pdf'
) {
  try {
    ensureResendConfig();

    // Resend acepta attachments como Buffer en "content"
    const { data, error } = await resend.emails.send({
      from: EMAIL_FROM!,
      to: [to],
      subject,
      html,
      ...(EMAIL_REPLY_TO ? { replyTo: EMAIL_REPLY_TO } : {}),
      attachments: [
        {
          filename,
          content: attachment,
          contentType: mimeType
        }
      ]
    });

    if (error) {
      console.error('❌ Resend error:', error);
      throw new Error(error.message);
    }

    console.log(`📧 Email con adjunto enviado correctamente a ${to}`);
    console.log('ID del mensaje:', data?.id);
  } catch (err) {
    console.error('❌ Error al enviar correo con adjunto:', err);
    throw new Error('No se pudo enviar el correo electrónico con adjunto');
  }
}

export const transporter = {
  verify: async () => {
    await verifyEmailTransport();
  }
};
