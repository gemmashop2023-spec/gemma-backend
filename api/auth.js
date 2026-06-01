import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export const config = { maxDuration: 30 };

function hashPassword(password) {
  return crypto.createHash('sha256')
    .update(password + process.env.CRON_SECRET)
    .digest('hex');
}

function generateToken(userId) {
  const payload = userId + '|' + Date.now() + '|' + process.env.CRON_SECRET;
  return crypto.createHash('sha256').update(payload).digest('hex') + '.' + Buffer.from(userId + '|' + Date.now()).toString('base64');
}

function verifyToken(token) {
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const decoded = Buffer.from(parts[1], 'base64').toString();
    const [userId, timestamp] = decoded.split('|');
    // Token valido per 24 ore
    if (Date.now() - parseInt(timestamp) > 24 * 60 * 60 * 1000) return null;
    return userId;
  } catch { return null; }
}

async function logAttivita(utenteId, username, azione, sezione, dettaglio, ip) {
  try {
    await supabase.from('log_attivita').insert({
      id: 'LOG-' + Date.now(),
      utente_id: utenteId,
      username,
      azione,
      sezione,
      dettaglio,
      ip,
    });
  } catch {}
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const body = req.body || {};
  const { action } = body;
  const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';

  try {
    // ── LOGIN ──────────────────────────────────────────────
    if (action === 'login') {
      const { username, password } = body;
      if (!username || !password) {
        return res.status(400).json({ success: false, error: 'Username e password richiesti' });
      }

      const hash = hashPassword(password);
      const { data: utente, error } = await supabase
        .from('utenti')
        .select('*')
        .eq('username', username.toLowerCase())
        .eq('password_hash', hash)
        .eq('attivo', true)
        .single();

      if (error || !utente) {
        await logAttivita(null, username, 'LOGIN_FALLITO', 'Auth', 'Password errata', ip);
        return res.status(401).json({ success: false, error: 'Credenziali non valide' });
      }

      // Aggiorna ultimo accesso
      await supabase.from('utenti').update({ ultimo_accesso: new Date().toISOString() }).eq('id', utente.id);

      const token = generateToken(utente.id);
      await logAttivita(utente.id, username, 'LOGIN', 'Auth', 'Accesso effettuato', ip);

      return res.json({
        success: true,
        token,
        utente: { id: utente.id, username: utente.username, nome: utente.nome, ruolo: utente.ruolo }
      });
    }

    // ── VERIFICA TOKEN ─────────────────────────────────────
    if (action === 'verifyToken') {
      const token = body.token || req.headers.authorization?.replace('Bearer ', '');
      const userId = verifyToken(token);
      if (!userId) return res.status(401).json({ success: false, error: 'Token non valido' });

      const { data: utente } = await supabase.from('utenti').select('id,username,nome,ruolo,attivo').eq('id', userId).single();
      if (!utente || !utente.attivo) return res.status(401).json({ success: false, error: 'Utente non attivo' });

      return res.json({ success: true, utente });
    }

    // ── LOG AZIONE ─────────────────────────────────────────
    if (action === 'logAzione') {
      const token = req.headers.authorization?.replace('Bearer ', '');
      const userId = verifyToken(token);
      if (!userId) return res.status(401).json({ success: false, error: 'Non autorizzato' });

      const { data: utente } = await supabase.from('utenti').select('username').eq('id', userId).single();
      await logAttivita(userId, utente?.username, body.azione, body.sezione, body.dettaglio, ip);
      return res.json({ success: true });
    }

    // ── GESTIONE UTENTI (solo admin) ───────────────────────
    const token = req.headers.authorization?.replace('Bearer ', '');
    const userId = verifyToken(token);
    if (!userId) return res.status(401).json({ success: false, error: 'Non autorizzato' });

    const { data: adminUser } = await supabase.from('utenti').select('ruolo,username').eq('id', userId).single();
    if (adminUser?.ruolo !== 'admin') return res.status(403).json({ success: false, error: 'Permessi insufficienti' });

    if (action === 'getUtenti') {
      const { data } = await supabase.from('utenti').select('id,username,nome,ruolo,attivo,ultimo_accesso,creato_il').order('creato_il');
      return res.json({ success: true, data });
    }

    if (action === 'creaUtente') {
      const { username, password, nome, ruolo } = body;
      const hash = hashPassword(password);
      const { data, error } = await supabase.from('utenti').insert({
        id: 'USR-' + Date.now(),
        username: username.toLowerCase(),
        password_hash: hash,
        nome,
        ruolo: ruolo || 'operatore',
      }).select().single();
      if (error) return res.status(400).json({ success: false, error: error.message });
      await logAttivita(userId, adminUser.username, 'CREA_UTENTE', 'Utenti', 'Creato utente: ' + username, ip);
      return res.json({ success: true, data });
    }

    if (action === 'aggiornaUtente') {
      const upd = {};
      if (body.nome)     upd.nome   = body.nome;
      if (body.ruolo)    upd.ruolo  = body.ruolo;
      if (body.attivo !== undefined) upd.attivo = body.attivo;
      if (body.password) upd.password_hash = hashPassword(body.password);
      const { data, error } = await supabase.from('utenti').update(upd).eq('id', body.id).select().single();
      if (error) return res.status(400).json({ success: false, error: error.message });
      await logAttivita(userId, adminUser.username, 'AGGIORNA_UTENTE', 'Utenti', 'Aggiornato: ' + body.id, ip);
      return res.json({ success: true, data });
    }

    if (action === 'getLog') {
      const limit = parseInt(body.limit || 100);
      const filtroUtente = body.utente_id;
      let query = supabase.from('log_attivita').select('*').order('data', { ascending: false }).limit(limit);
      if (filtroUtente) query = query.eq('utente_id', filtroUtente);
      const { data } = await query;
      return res.json({ success: true, data });
    }

    return res.status(400).json({ success: false, error: 'Azione non riconosciuta' });

  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
