import { syncAmazon } from '../lib/amazon.js';
import { syncEbay }   from '../lib/ebay.js';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  // Vercel chiama questo endpoint automaticamente ogni 30 minuti
  // (configurato in vercel.json)
  
  // Sicurezza: accetta solo chiamate da Vercel Cron
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Non autorizzato' });
  }

  const results = {};

  try {
    results.amazon = await syncAmazon();
  } catch (err) {
    results.amazon = { errore: err.message };
  }

  try {
    results.ebay = await syncEbay();
  } catch (err) {
    results.ebay = { errore: err.message };
  }

  console.log('Sync automatica completata:', results);
  res.status(200).json({ success: true, results });
}
