// src/utils/supabaseAdmin.ts
import { createClient } from '@supabase/supabase-js';
import { BILLING_CONFIG } from '../config/billing.config.js';

export const supabaseAdmin = createClient(
  BILLING_CONFIG.SUPABASE_URL,
  BILLING_CONFIG.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false },
    global: { headers: { 'X-Client-Info': 'backend-service-role' } }
  }
);
