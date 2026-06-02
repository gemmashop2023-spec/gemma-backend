import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// CORS headers
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json'
};

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { action, ...extra } = body;

    if (!action) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Azione non specificata' }) };
    }

    // ── DASHBOARD ──────────────────────────────────────────
    if (action === 'getDashboard') {
      const [ordini, acquisti, resi] = await Promise.all([
        supabase.from('ordini_amazon').select('stato, totale, scadenza_evasione').limit(500),
        supabase.from('ordini_acquisto').select('stato').limit(500),
        supabase.from('resi_clienti').select('stato').limit(200)
      ]);

      const kpi = {
        da_acquistare: 0, da_spedire: 0, da_ricevere: 0, da_verificare: 0, completati_oggi: 0
      };
      const oggi = new Date().toDateString();
      (ordini.data || []).forEach(o => {
        if (o.stato === 'da-acquistare') kpi.da_acquistare++;
        if (o.stato === 'da-spedire') kpi.da_spedire++;
        if (o.stato === 'da-ricevere') kpi.da_ricevere++;
        if (o.stato === 'da-verificare') kpi.da_verificare++;
        if (o.stato === 'completato' && new Date(o.scadenza_evasione).toDateString() === oggi) kpi.completati_oggi++;
      });

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: { kpi } }) };
    }

    // ── SYNC AMAZON ────────────────────────────────────────
    if (action === 'syncAll') {
      const { syncAmazon } = await import('./lib/amazon.js');
      const result = await syncAmazon();
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, ...result }) };
    }

    // ── GET ALL ─────────────────────────────────────────────
    if (action === 'getAll') {
      const { table } = extra;
      if (!table) return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Tabella non specificata' }) };
      const { data, error } = await supabase.from(table).select('*').order('creato_il', { ascending: false }).limit(500);
      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data }) };
    }

    // ── UPSERT ──────────────────────────────────────────────
    if (action === 'upsert') {
      const { table, record } = extra;
      const { data, error } = await supabase.from(table).upsert(record).select().single();
      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data }) };
    }

    // ── AGGIORNA STATO ──────────────────────────────────────
    if (action === 'aggiornaStato') {
      const { id, stato } = extra;
      const tables = ['ordini_amazon', 'ordini_ebay', 'resi_clienti', 'ordini_acquisto'];
      for (const t of tables) {
        const { data } = await supabase.from(t).update({ stato }).eq('id', id).select();
        if (data && data.length > 0) {
          return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
        }
      }
      return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: 'Record non trovato' }) };
    }

    // ── INVIA MESSAGGIO AMAZON ──────────────────────────────
    if (action === 'inviaMessaggioAmazon') {
      const { orderId, testo } = extra;
      const tokenRes = await fetch('https://api.amazon.com/auth/o2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: process.env.AMAZON_REFRESH_TOKEN,
          client_id: process.env.AMAZON_CLIENT_ID,
          client_secret: process.env.AMAZON_CLIENT_SECRET,
        })
      });
      const tokenData = await tokenRes.json();
      const accessToken = tokenData.access_token;
      if (!accessToken) throw new Error('Token Amazon non ottenuto');

      const msgRes = await fetch(
        `https://sellingpartnerapi-eu.amazon.com/messaging/v1/orders/${orderId}/messages`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'x-amz-access-token': accessToken,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ body: testo, marketplaceId: process.env.AMAZON_MARKETPLACE_ID || 'APJ6JRA9NG5V4' })
        }
      );

      await supabase.from('messaggi_clienti').insert({
        id: 'MSG-' + Date.now(), ordine_id: orderId,
        canale: 'Amazon', direzione: 'uscita', testo, stato: 'inviato',
        creato_il: new Date().toISOString()
      }).catch(() => {});

      return { statusCode: 200, headers, body: JSON.stringify({ success: msgRes.ok }) };
    }

    // ── AUTH ────────────────────────────────────────────────
    if (action === 'login' || action === 'verifyToken' || action === 'getUtenti' || 
        action === 'creaUtente' || action === 'aggiornaUtente' || action === 'getLog') {
      const { handler: authHandler } = await import('./auth.js');
      return authHandler(event);
    }

    return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Azione non riconosciuta: ' + action }) };

  } catch (err) {
    console.error('API error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
