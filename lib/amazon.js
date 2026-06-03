import { upsert, insert, getAll, logSync } from './supabase.js';

// ── TOKEN ─────────────────────────────────────────────────
let _tokenCache = null;
let _tokenExpiry = 0;

async function getToken() {
  if (_tokenCache && Date.now() < _tokenExpiry) return _tokenCache;

  const res = await fetch('https://api.amazon.com/auth/o2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: process.env.AMAZON_REFRESH_TOKEN,
      client_id:     process.env.AMAZON_CLIENT_ID,
      client_secret: process.env.AMAZON_CLIENT_SECRET,
    }),
  });

  const data = await res.json();
  if (!data.access_token) throw new Error('Amazon token error: ' + JSON.stringify(data));

  _tokenCache  = data.access_token;
  _tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return _tokenCache;
}

async function callAPI(path, params = {}) {
  const token = await getToken();
  const qs = new URLSearchParams(params).toString();
  const url = `https://sellingpartnerapi-eu.amazon.com${path}${qs ? '?' + qs : ''}`;

  const res = await fetch(url, {
    headers: {
      'x-amz-access-token': token,
      'Content-Type': 'application/json',
    },
  });

  const json = await res.json();
  if (json.errors) throw new Error('Amazon API: ' + JSON.stringify(json.errors));
  return json;
}

// ── SYNC ORDINI ──────────────────────────────────────────────
export async function syncAmazon(giorni = 30) {
  const log = { piattaforma: 'Amazon', inizio: new Date().toISOString(), nuovi: 0, aggiornati: 0, cancellazioni: 0 };

  try {
    const createdAfter = new Date(Date.now() - giorni * 24 * 60 * 60 * 1000).toISOString();
    let nextToken = null;

    // Carica magazzino per check disponibilità
    const magazzino = await getAll('magazzino');

    do {
      const params = {
        MarketplaceIds:  process.env.AMAZON_MARKETPLACE_ID || 'APJ6JRA9NG5V4',
        CreatedAfter:    createdAfter,
        OrderStatuses:   'Unshipped,PartiallyShipped,Shipped,Canceled,Pending',
      };
      if (nextToken) params.NextToken = nextToken;

      const res  = await callAPI('/orders/v0/orders', params);
      const orders = res.payload?.Orders || [];
      nextToken  = res.payload?.NextToken;

      for (const ord of orders) {
        const result = await upsertOrder(ord, magazzino);
        if (result === 'nuovo')      log.nuovi++;
        if (result === 'aggiornato') log.aggiornati++;
        if (ord.OrderStatus === 'Canceled') log.cancellazioni++;
      }
    } while (nextToken);

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

async function upsertOrder(ord, magazzino) {
  // Recupera prodotti ordine
  let prodotto = '', sku = '';
  try {
    const items = await callAPI(`/orders/v0/orders/${ord.AmazonOrderId}/orderItems`);
    const item  = items.payload?.OrderItems?.[0];
    prodotto    = item?.Title || '';
    sku         = item?.SellerSKU || '';
  } catch {}

  // Determina stato GEMMA
  let stato = 'da-acquistare';
  if (ord.OrderStatus === 'Canceled') {
    stato = 'cancellato';
  } else if (sku) {
    const inMag = magazzino.find(p => p.sku === sku && parseInt(p.quantita) > 0);
    stato = inMag ? 'da-spedire' : 'da-acquistare';
  }

  const id = 'AMZ-' + ord.AmazonOrderId.replace(/-/g, '');

  await upsert('ordini_amazon', {
    id,
    numero_ordine:      ord.AmazonOrderId,
    prodotto,
    sku,
    cliente:            ord.BuyerInfo?.BuyerName || '',  // Nome account buyer Amazon
    marketplace:        ord.SalesChannel || 'Amazon.it',
    totale:             parseFloat(ord.OrderTotal?.Amount || 0),
    valuta:             ord.OrderTotal?.CurrencyCode || 'EUR',
    scadenza_evasione:  ord.LatestShipDate || null,
    stato,
    indirizzo_consegna: formatAddr(ord.ShippingAddress),
    amazon_status:      ord.OrderStatus,
    data_ordine:        ord.PurchaseDate || null,
  });

  // Se cancellato → registra in tabella cancellazioni
  if (ord.OrderStatus === 'Canceled') {
    await upsert('cancellazioni', {
      id:             'CAN-' + ord.AmazonOrderId.replace(/-/g, ''),
      ordine_id:      ord.AmazonOrderId,
      prodotto,
      stato_gestione: 'da-gestire',
    });
  }

  return 'aggiornato';
}

// ── SYNC RESI/RIMBORSI ────────────────────────────────────────
export async function syncRimborsi() {
  let nuovi = 0;
  try {
    const postedAfter = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const res = await callAPI('/finances/v0/financialEvents', { PostedAfter: postedAfter });
    const refunds = res.payload?.FinancialEvents?.RefundEventList || [];

    for (const ref of refunds) {
      if (!ref.AmazonOrderId) continue;
      await upsert('rimborsi_amazon', {
        id:       'RIMB-' + ref.AmazonOrderId.replace(/-/g, '') + '-' + Date.now(),
        ordine_id: ref.AmazonOrderId,
        importo:   parseFloat(ref.ChargeComponentList?.[0]?.ChargeAmount?.Amount || 0),
        data:      ref.PostedDate || new Date().toISOString(),
        motivo:    'Rimborso Amazon',
        stato:     'da-classificare',
      });
      nuovi++;
    }
  } catch {}
  return nuovi;
}

function formatAddr(addr) {
  if (!addr) return '';
  return [addr.AddressLine1, addr.City, addr.PostalCode, addr.CountryCode]
    .filter(Boolean).join(', ');
}

// ── INVIO MESSAGGIO ACQUIRENTE ──────────────────────────

export async function inviaMessaggioAcquirente(orderId, testo, accessToken) {
  try {
    // Amazon Buyer-Seller Messaging API
    const url = `https://sellingpartnerapi-eu.amazon.com/messaging/v1/orders/${orderId}/messages/confirmCustomizationDetails`;
    
    // Use generic confirmDeliveryDetails endpoint for custom messages
    const msgUrl = `https://sellingpartnerapi-eu.amazon.com/messaging/v1/orders/${orderId}/messages`;
    
    const body = {
      subject: 'Informazione sul tuo ordine',
      body: testo,
      marketplaceId: process.env.AMAZON_MARKETPLACE_ID || 'APJ6JRA9NG5V4'
    };

    const res = await fetch(msgUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'x-amz-access-token': accessToken,
        'Content-Type': 'application/json',
        'x-amzn-marketplace-id': process.env.AMAZON_MARKETPLACE_ID || 'APJ6JRA9NG5V4'
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Amazon messaging error: ${res.status} - ${err}`);
    }

    return { success: true };
  } catch (err) {
    console.error('inviaMessaggioAcquirente error:', err.message);
    return { success: false, error: err.message };
  }
}

export async function syncResi() {
  let nuovi = 0;
  try {
    const res = await callAPI('/orders/v0/orders', {
      MarketplaceIds: process.env.AMAZON_MARKETPLACE_ID || 'APJ6JRA9NG5V4',
      CreatedAfter: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      OrderStatuses: 'Canceled'
    });
    const orders = res.payload?.Orders || [];
    for (const ord of orders) {
      if (!ord.AmazonOrderId) continue;
      await upsert('resi_clienti', {
        id: 'RESO-' + ord.AmazonOrderId.replace(/-/g,''),
        numero_ordine: ord.AmazonOrderId,
        cliente: ord.BuyerInfo?.BuyerName || '',
        stato: 'da-valutare',
        motivo: 'Richiesta da Amazon',
        data: ord.PurchaseDate || new Date().toISOString(),
        importo: parseFloat(ord.OrderTotal?.Amount || 0),
        creato_il: new Date().toISOString()
      });
      nuovi++;
    }
  } catch(e) { console.log('syncResi error:', e.message); }
  return nuovi;
}

export async function syncMessaggi() {
  // Amazon Buyer-Seller messages - requires separate API call per order
  // Basic implementation - logs recent messages
  return 0;
}
