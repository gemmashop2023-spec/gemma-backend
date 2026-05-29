import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default supabase;

// ── HELPERS ──────────────────────────────────────────────────

export async function getAll(table) {
  const { data, error } = await supabase.from(table).select('*').order('creato_il', { ascending: false });
  if (error) throw error;
  return data;
}

export async function getById(table, id) {
  const { data, error } = await supabase.from(table).select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

export async function upsert(table, record) {
  const { data, error } = await supabase.from(table).upsert(record).select().single();
  if (error) throw error;
  return data;
}

export async function update(table, id, fields) {
  const { data, error } = await supabase.from(table).update(fields).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function insert(table, record) {
  const { data, error } = await supabase.from(table).insert(record).select().single();
  if (error) throw error;
  return data;
}

export async function remove(table, id) {
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error) throw error;
  return { deleted: true };
}

export async function logSync(entry) {
  try {
    await insert('log_sync', { id: 'LOG-' + Date.now(), ...entry });
  } catch {}
}
