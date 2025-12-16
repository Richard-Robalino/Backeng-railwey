// src/config/billing.config.ts
export const BILLING_CONFIG = {
    // Factura PDF (hardcodeado)
    INVOICE_SHOP_NAME: 'Peluquería Lina',
    INVOICE_SHOP_ADDRESS: 'Av. Siempre Viva 123, Quito',
    INVOICE_SHOP_RUC: '1234567890001',
    // Banco Pichincha (hardcodeado)
    PICHINCHA_ACCOUNT_NUMBER: '2211389849',
    PICHINCHA_ACCOUNT_HOLDER: 'Richard Robalino/ Lina Salon',
    PICHINCHA_ACCOUNT_TYPE: 'Cuenta corriente',
    PICHINCHA_BANK_NAME: 'Banco Pichincha',
    // Panel admin confirm (hardcodeado)
    ADMIN_CONFIRM_URL_BASE: 'http://localhost:4200/admin/payments/confirm',
    // Supabase (hardcodeado)
    SUPABASE_URL: 'https://bxhlrenmsbyttxhbzkgy.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ4aGxyZW5tc2J5dHR4aGJ6a2d5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzAyNzQ2MSwiZXhwIjoyMDc4NjAzNDYxfQ.LXFfCrwv0qet9k51XDoBn8J5ZkQ79qcxBfr1MSRw_JY',
    // Bucket (lo usas para services; aquí lo reutilizamos con carpeta)
    SUPABASE_BUCKET_SERVICES: 'services',
    // Upload constraints
    UPLOAD_MAX_MB: 2,
    UPLOAD_ALLOWED_MIME: ['image/jpeg', 'image/png', 'image/webp'],
    // TZ para mostrar fechas
    TZ: 'America/Guayaquil'
};
