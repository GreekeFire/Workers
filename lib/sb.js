const { createClient } = require('@supabase/supabase-js');

const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const sb = createClient(
  'https://tzwzmzabjmsocnxdtxqx.supabase.co',
  SERVICE_KEY,
  { auth: { persistSession: false } }
);

const sgtToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

module.exports = { sb, SERVICE_KEY, sgtToday };
