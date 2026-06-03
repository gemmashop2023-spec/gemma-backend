import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { syncAmazon } from '../lib/amazon.js';

const app = express();
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

app.post('/api/index', handler);
app.get('/api/index', (req, res) => res.json({ success: true, status: 'GEMMA API online' }));
app.get('/', (req, res) => res.json({ success: true, status: 'GEMMA API online' }));

async function handler(req, res) {
  try {
    const body = req.body || {};
    const { action } = body;

    if (!action) {
      return res.status(400).json({ success: false, error: 'Azione non specificata' });
    }

    if (action === 'getDashboard') {
      const { data: ordini } = await supabase.from('ordini_amazon').select('stato, totale').limit(500);
      const kpi = { da_acquistare: 0, da_spedire: 0, da_ricevere: 0, da_verificare: 0 };
      (ordini || []).forEach(o => {
        if (o.stato === 'da-acquistare') kpi.da_acquistare++;
        if (o.stato === 'da-spedire') kpi.da_spedire++;
        if (o.stato === 'da-ricevere') kpi.da_ricevere++;
        if (o.stato === 'da-verificare') kpi.da_verificare++;
      });
      return res.json({ success: true, data: { kpi } });
    }

    if (action === 'syncAll') {
      const { syncRimborsi, syncResi } = await import('../lib/amazon.js');
      const [amazonResult, rimborsiNuovi, resiNuovi] = await Promise.all([
        syncAmazon(),
        syncRimborsi().catch(() => 0),
        syncResi().catch(() => 0)
      ]);
      return res.json({ 
        success: true, 
        ...amazonResult,
        rimborsi_nuovi: rimborsiNuovi,
        resi_nuovi: resiNuovi
      });
    }

    if (action === 'getAll') {
      const { table } = body;
      if (!table) return res.status(400).json({ success: false, error: 'Tabella non specificata' });
      let query = supabase.from(table).select('*').limit(500);
      const { data, error } = await query;
      if (error) return res.status(500).json({ success: false, error: error.message });
      return res.json({ success: true, data });
    }

    if (action === 'upsert' || action === 'aggiornaOrdine' || action === 'aggiornaReso' || action === 'aggiornaPratica') {
      const { table, record, id, action: _, ...fields } = body;
      const tbl = table || (action === 'aggiornaOrdine' ? 'ordini_amazon' : action === 'aggiornaReso' ? 'resi_clienti' : 'pratiche_assicurative');
      const { data, error } = record
        ? await supabase.from(tbl).upsert(record).select().single()
        : await supabase.from(tbl).update(fields).eq('id', id || fields.id).select().single();
      if (error) return res.status(500).json({ success: false, error: error.message });
      return res.json({ success: true, data });
    }

    if (action === 'inviaMessaggioAmazon') {
      const { orderId, testo } = body;
      if (!orderId || !testo) return res.status(400).json({ success: false, error: 'orderId e testo richiesti' });
      const tokenRes = await fetch('https://api.amazon.com/auth/o2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: process.env.AMAZON_REFRESH_TOKEN,
          client_id: process.env.AMAZON_CLIENT_ID,
          client_secret: process.env.AMAZON_CLIENT_SECRET,
        }).toString()
      });
      const { access_token } = await tokenRes.json();
      if (!access_token) return res.status(401).json({ success: false, error: 'Token Amazon non ottenuto' });
      const msgRes = await fetch(
        `https://sellingpartnerapi-eu.amazon.com/messaging/v1/orders/${orderId}/messages`,
        { method: 'POST', headers: { 'Authorization': `Bearer ${access_token}`, 'x-amz-access-token': access_token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: testo, marketplaceId: process.env.AMAZON_MARKETPLACE_ID || 'APJ6JRA9NG5V4' }) }
      );
      await supabase.from('messaggi_clienti').insert({ id: 'MSG-' + Date.now(), ordine_id: orderId, canale: 'Amazon', direzione: 'uscita', testo, stato: 'inviato', creato_il: new Date().toISOString() }).catch(() => {});
      return res.json({ success: msgRes.ok, status: msgRes.status });
    }

    if (action === 'creaPratica' || action === 'caricoProdotto' || action === 'logMessaggio' || action === 'vendita_banco') {
      const { action: _, ...record } = body;
      const tbl = action === 'creaPratica' ? 'pratiche_assicurative' : action === 'caricoProdotto' ? 'catalogo' : action === 'vendita_banco' ? 'vendite_banco' : 'messaggi_clienti';
      const { data, error } = await supabase.from(tbl).insert(record).select().single();
      if (error) return res.status(500).json({ success: false, error: error.message });
      return res.json({ success: true, data });
    }

    if (action === 'getUtenti') {
      const { data } = await supabase.from('utenti').select('id,username,nome,ruolo,attivo,ultimo_accesso,creato_il').order('creato_il');
      return res.json({ success: true, data });
    }

    if (action === 'creaUtente') {
      const { username, password, nome, ruolo } = body;
      const crypto = await import('crypto');
      const hash = crypto.default.createHash('sha256').update(password + (process.env.CRON_SECRET || '')).digest('hex');
      const { data, error } = await supabase.from('utenti').insert({ id: 'USR-' + Date.now(), username: username.toLowerCase(), password_hash: hash, nome, ruolo: ruolo || 'operatore' }).select().single();
      if (error) return res.status(400).json({ success: false, error: error.message });
      return res.json({ success: true, data });
    }

    if (action === 'aggiornaUtente') {
      const { id, password, action: _, ...fields } = body;
      if (password) {
        const crypto = await import('crypto');
        fields.password_hash = crypto.default.createHash('sha256').update(password + (process.env.CRON_SECRET || '')).digest('hex');
      }
      const { data, error } = await supabase.from('utenti').update(fields).eq('id', id).select().single();
      if (error) return res.status(400).json({ success: false, error: error.message });
      return res.json({ success: true, data });
    }

    if (action === 'getLog') {
      const { data } = await supabase.from('log_attivita').select('*').order('data', { ascending: false }).limit(100);
      return res.json({ success: true, data });
    }

    return res.json({ success: false, error: 'Azione non riconosciuta: ' + action });

  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`GEMMA API running on port ${PORT}`));
