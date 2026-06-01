import { upsert, logSync } from './supabase.js';

// ── TOKEN ─────────────────────────────────────────────────
let _tokenCache = null;
let _tokenExpiry = 0;

async function getToken() {
  if (_tokenCache && Date.now() < _tokenExpiry) return _tokenCache;

  const credentials = Buffer.from(
    `${process.env.EBAY_APP_ID}:${process.env.EBAY_CERT_ID}`
  ).toString('base64');

  const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type':  'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: process.env.EBAY_REFRESH_TOKEN,
      scope:         'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
    }),
  });

  const data = await res.json();
  if (!data.access_token) throw new Error('eBay token error: ' + JSON.stringify(data));

  _tokenCache  = data.access_token;
  _tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return _tokenCache;
}

async function callAPI(path, params = {}) {
  const token = await getToken();
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`https://api.ebay.com${path}${qs ? '?' + qs : ''}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json',
    },
  });
  return res.json();
}

// ── SYNC ORDINI ──────────────────────────────────────────────
export async function syncEbay() {
  const log = { piattaforma: 'eBay', inizio: new Date().toISOString(), nuovi: 0, aggiornati: 0 };

  try {
    const filter = `creationdate:[${new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()}..]`;
    let offset = 0, total = 1;

    while (offset < total) {
      const res = await callAPI('/sell/fulfillment/v1/order', {
        filter, limit: '50', offset: String(offset),
      });

      total  = parseInt(res.total || 0);
      offset += 50;

      for (const ord of (res.orders || [])) {
        const r = await upsertEbay(ord);
        if (r === 'nuovo')      log.nuovi++;
        if (r === 'aggiornato') log.aggiornati++;
      }
    }

    log.fine  = new Date().toISOString();
    log.esito = 'OK';
  } catch (err) {
    log.fine   = new Date().toISOString();
    log.esito  = 'ERRORE';
    log.errore = err.message;
  }

  await logSync(log);
  return log;
}

async function upsertEbay(ord) {
  const item    = ord.lineItems?.[0] || {};
  const dest    = ord.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo;
  const addr    = dest?.contactAddress;

  await upsert('ordini_ebay', {
    id:                'EBY-' + ord.orderId.replace(/[^a-z0-9]/gi, ''),
    numero_ordine:     ord.orderId,
    prodotto:          item.title || '',
    sku:               item.sku || '',
    cliente:           ord.buyer?.username || dest?.fullName || '',  // Account buyer eBay
    totale:            parseFloat(ord.pricingSummary?.total?.value || 0),
    valuta:            ord.pricingSummary?.total?.currency || 'EUR',
    stato:             mapStato(ord.orderFulfillmentStatus),
    data_ordine:       ord.creationDate || null,
    indirizzo_consegna: addr
      ? [addr.addressLine1, addr.city, addr.postalCode, addr.countryCode].filter(Boolean).join(', ')
      : '',
    ebay_status:       ord.orderFulfillmentStatus,
  });

  return 'aggiornato';
}

function mapStato(s) {
  return { NOT_STARTED: 'da-spedire', IN_PROGRESS: 'in-lavorazione', FULFILLED: 'completato' }[s] || 'da-spedire';
}
