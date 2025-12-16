import PDFDocument from 'pdfkit';
import { BILLING_CONFIG } from '../../config/billing.config.js';
function formatEC(d) {
    return new Intl.DateTimeFormat('es-EC', {
        timeZone: BILLING_CONFIG.TZ,
        dateStyle: 'medium',
        timeStyle: 'short'
    }).format(d);
}
export function generateInvoicePdf({ booking, client, stylist, service, payment }) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 50 });
        const buffers = [];
        doc.on('data', (chunk) => buffers.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(buffers)));
        doc.on('error', reject);
        // ✅ hardcodeado (no .env)
        const shopName = BILLING_CONFIG.INVOICE_SHOP_NAME;
        const shopAddress = BILLING_CONFIG.INVOICE_SHOP_ADDRESS;
        const shopRuc = BILLING_CONFIG.INVOICE_SHOP_RUC;
        // HEADER
        doc.fontSize(20).text(shopName, { align: 'left' });
        doc.fontSize(10).text(shopAddress).text(shopRuc);
        doc.fontSize(18).text(`FACTURA #${payment.invoiceNumber}`, { align: 'right' });
        doc.moveDown();
        // Datos de factura
        doc
            .fontSize(12)
            .text(`Fecha de emisión: ${formatEC(payment.paidAt)}`)
            .text(`Método de pago: ${payment.method === 'CARD' ? 'Tarjeta' : 'Transferencia Banco Pichincha'}`)
            .text(`ID de reserva: ${booking.id}`);
        doc.moveDown();
        // CLIENTE
        doc.fontSize(14).text('Datos del cliente', { underline: true });
        doc.fontSize(12);
        if (client) {
            doc.text(`Nombre: ${client.nombre} ${client.apellido || ''}`.trim());
            doc.text(`Email: ${client.email}`);
        }
        else {
            doc.text('Nombre: Cliente');
        }
        doc.moveDown();
        // ESTILISTA
        doc.fontSize(14).text('Datos del estilista', { underline: true });
        doc.fontSize(12);
        if (stylist) {
            doc.text(`Nombre: ${stylist.nombre} ${stylist.apellido || ''}`.trim());
            doc.text(`Email: ${stylist.email}`);
        }
        doc.moveDown();
        // DETALLE CITA
        doc.fontSize(14).text('Detalle de la cita', { underline: true });
        doc.fontSize(12);
        doc.text(`Fecha y hora: ${formatEC(booking.inicio)}`);
        doc.text(`Duración: ${service.duracionMin} minutos`);
        doc.moveDown();
        // TABLA
        doc.fontSize(14).text('Detalle de servicios', { underline: true });
        doc.moveDown(0.5);
        doc.fontSize(12).text('Servicio', 50, doc.y, { continued: true });
        doc.text('Duración (min)', 250, doc.y, { continued: true });
        doc.text('Precio', 400, doc.y);
        doc.moveDown();
        doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
        doc.moveDown(0.5);
        doc.text(service.nombre, 50, doc.y, { continued: true });
        doc.text(String(service.duracionMin), 250, doc.y, { continued: true });
        doc.text(`$${service.precio.toFixed(2)}`, 400, doc.y);
        doc.moveDown();
        doc.fontSize(14).text(`TOTAL: $${payment.amount.toFixed(2)}`, { align: 'right' });
        doc.end();
    });
}
