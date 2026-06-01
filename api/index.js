import { getAll, getById, insert, update, upsert, remove } from '../lib/supabase.js';
import { syncAmazon, syncRimborsi } from '../lib/amazon.js';
import { syncEbay } from '../lib/ebay.js';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  // CORS — permette accesso dal file HTML locale e dal dominio Aruba
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { action, table, id } = { ...req.query, ...(req.body || {}) };
    const body = req.body || {};
    let result;

    switch (action) {

      // ── LETTURA ────────────────────────────────────────────
      case 'getAll':
        result = await getAll(table);
        break;

      case 'getById':
        result = await getById(table, id);
        break;

      case 'getDashboard':
        result = await getDashboard();
        break;

      // ── SYNC PIATTAFORME ───────────────────────────────────
      case 'syncAmazon':
        result = await syncAmazon();
        break;

      case 'syncEbay':
        result = await syncEbay();
        break;

      case 'syncAll': {
        const [amz, ebay] = await Promise.allSettled([syncAmazon(), syncEbay()]);
        result = {
          amazon: amz.status === 'fulfilled' ? amz.value : { errore: amz.reason?.message },
          ebay:   ebay.status === 'fulfilled' ? ebay.value : { errore: ebay.reason?.message },
        };
        break;
      }

      // ── ORDINI: AGGIORNA STATO + FLAG ──────────────────────
      case 'aggiornaStato': {
        const upd = { stato: body.stato };
        if (body.tracking)  upd.tracking = body.tracking;
        if (body.stato === 'da-ricevere')   upd.data_spedizione  = new Date().toISOString();
        if (body.stato === 'da-verificare') upd.data_consegna    = new Date().toISOString();
        if (body.stato === 'completato')    upd.data_completato  = new Date().toISOString();
        result = await update('ordini_amazon', body.id, upd);
        break;
      }

      case 'aggiornaFlag': {
        const flags = {};
        if (body.flag_spedito        !== undefined) flags.flag_spedito        = body.flag_spedito;
        if (body.flag_consegnato     !== undefined) flags.flag_consegnato     = body.flag_consegnato;
        if (body.flag_verificato_24h !== undefined) flags.flag_verificato_24h = body.flag_verificato_24h;
        if (body.tracking) flags.tracking = body.tracking;
        result = await update('ordini_amazon', body.id, flags);
        break;
      }

      // ── ACQUISTI (manuali) ─────────────────────────────────
      case 'creaAcquisto': {
        const n = await getAll('acquisti');
        body.data.id = 'ACQ-' + String(n.length + 1).padStart(3, '0') + '-' + Date.now();
        result = await insert('acquisti', body.data);
        break;
      }

      case 'updateAcquisto':
        result = await update('acquisti', body.id, body.data);
        break;

      case 'collegaAcquisto':
        // Collega acquisto a ordine Amazon e aggiorna stato ordine
        await update('ordini_amazon', body.ordine_id, {
          acq_id:          body.acq_id,
          acq_piattaforma: body.piattaforma,
          acq_venditore:   body.venditore,
          acq_prezzo:      body.prezzo,
          acq_stato:       'non-spedito',
          acq_destinazione: body.destinazione || 'verso-magazzino',
        });
        result = { collegato: true };
        break;

      case 'updateAcqStato': {
        // Aggiorna stato acquisto su ordine Amazon
        const acqUpdate = { acq_stato: body.acq_stato };
        if (body.acq_tracking) acqUpdate.acq_tracking = body.acq_tracking;
        // Se acquisto arrivato in magazzino → ordine diventa da-spedire
        if (body.acq_stato === 'consegnato' && body.acq_destinazione === 'verso-magazzino') {
          acqUpdate.stato = 'da-spedire';
        }
        // Se spedito direttamente al cliente → da-ricevere
        if (body.acq_stato === 'verso-cliente') {
          acqUpdate.stato = 'da-ricevere';
        }
        result = await update('ordini_amazon', body.ordine_id, acqUpdate);
        break;
      }

      // ── RESI CLIENTI ──────────────────────────────────────
      case 'creaReso': {
        const resi = await getAll('resi_clienti');
        body.data.id = 'RSAMZ-' + String(resi.length + 1).padStart(3, '0');
        result = await insert('resi_clienti', body.data);
        break;
      }

      case 'updateReso':
        result = await update('resi_clienti', body.id, body.data);
        break;

      // ── PRATICHE ASSICURATIVE ─────────────────────────────
      case 'apriPratica': {
        const pratiche = await getAll('rimborsi_assicurativi');
        const newId = 'RASSIC-' + String(pratiche.length + 1).padStart(3, '0');
        body.data.id      = newId;
        body.data.soggetto = body.data.soggetto || 'xCover';
        body.data.stato   = 'inviata';
        result = await insert('rimborsi_assicurativi', body.data);
        // Aggiorna reso con riferimento pratica
        if (body.data.reso_id) {
          await update('resi_clienti', body.data.reso_id, { pratica_assic_id: newId });
        }
        break;
      }

      case 'updatePratica':
        result = await update('rimborsi_assicurativi', body.id, body.data);
        break;

      // ── CONTESTAZIONI ─────────────────────────────────────
      case 'creaContestazione': {
        const cont = await getAll('contestazioni');
        body.data.id = 'CONT-' + String(cont.length + 1).padStart(3, '0');
        result = await insert('contestazioni', body.data);
        break;
      }

      case 'updateContestazione':
        result = await update('contestazioni', body.id, body.data);
        break;

      // ── RESI VENDITORI ────────────────────────────────────
      case 'creaResoVenditore': {
        const rv = await getAll('resi_venditori');
        body.data.id = 'RESO-' + String(rv.length + 1).padStart(3, '0');
        result = await insert('resi_venditori', body.data);
        break;
      }

      // ── MAGAZZINO ─────────────────────────────────────────
      case 'updateMagazzino':
        result = await update('magazzino', body.id, body.data);
        break;

      case 'creaMovimento': {
        body.data.id = 'MOV-' + Date.now();
        result = await insert('movimenti', body.data);
        break;
      }

      case 'inviaAssistenza': {
        const ass = await getAll('assistenza');
        const assId = 'ASS-' + String(ass.length + 1).padStart(3, '0');
        body.data.id = assId;
        result = await insert('assistenza', body.data);
        // Blocca il prodotto in magazzino
        await update('magazzino', body.data.sku_id, { in_assistenza: true, assist_id: assId });
        // Registra movimento uscita
        await insert('movimenti', {
          id: 'MOV-' + Date.now(),
          tipo: 'uscita',
          sku: body.data.sku,
          prodotto: body.data.prodotto,
          quantita: -1,
          causale: 'Inviato in assistenza',
          stato_prodotto: 'in-assistenza',
        });
        break;
      }

      // ── GENERICO ──────────────────────────────────────────
      case 'insert':
        result = await insert(table, body.data);
        break;

      case 'update':
        result = await update(table, id || body.id, body.data);
        break;

      case 'delete':
        result = await remove(table, id || body.id);
        break;

      default:
        return res.status(400).json({ success: false, error: 'Azione non riconosciuta: ' + action });
    }

    res.status(200).json({ success: true, data: result });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
}

// ── DASHBOARD ─────────────────────────────────────────────────

async function getDashboard() {
  const [ordini, ebay, acquisti, resi, magazzino, logSyncData] = await Promise.all([
    getAll('ordini_amazon'),
    getAll('ordini_ebay'),
    getAll('acquisti'),
    getAll('resi_clienti'),
    getAll('magazzino'),
    getAll('log_sync'),
  ]);

  const oggi = new Date().toDateString();

  const kpi = {
    da_acquistare:    ordini.filter(o => o.stato === 'da-acquistare').length,
    da_spedire:       ordini.filter(o => o.stato === 'da-spedire').length,
    da_ricevere:      ordini.filter(o => o.stato === 'da-ricevere').length,
    da_verificare:    ordini.filter(o => o.stato === 'da-verificare').length,
    completati_oggi:  ordini.filter(o => o.stato === 'completato' && new Date(o.data_completato).toDateString() === oggi).length,
    ebay_aperti:      ebay.filter(o => o.stato !== 'completato').length,
    resi_aperti:      resi.filter(r => r.stato !== 'chiuso').length,
    cancellazioni_oggi: ordini.filter(o => o.stato === 'cancellato' && new Date(o.aggiornato_il).toDateString() === oggi).length,
    sotto_soglia:     magazzino.filter(p => parseInt(p.quantita) <= parseInt(p.soglia_minima)).length,
    in_assistenza:    magazzino.filter(p => p.in_assistenza).length,
    fatturato_mese:   calcolaFatturato([...ordini, ...ebay]),
    costo_acquisti_mese: calcolaCosti(acquisti),
  };

  return {
    kpi,
    ultimi_ordini_amazon: ordini.slice(0, 5),
    ultimi_ordini_ebay:   ebay.slice(0, 5),
    scorte_critiche:      magazzino.filter(p => parseInt(p.quantita) <= parseInt(p.soglia_minima)).slice(0, 5),
    ultima_sync:          logSyncData[0] || null,
  };
}

function calcolaFatturato(ordini) {
  const now = new Date();
  return ordini
    .filter(o => {
      const d = new Date(o.data_ordine || o.creato_il);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    })
    .reduce((s, o) => s + (parseFloat(o.totale) || 0), 0);
}

function calcolaCosti(acquisti) {
  const now = new Date();
  return acquisti
    .filter(a => {
      const d = new Date(a.data || a.creato_il);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    })
    .reduce((s, a) => s + (parseFloat(a.prezzo) || 0), 0);
}
