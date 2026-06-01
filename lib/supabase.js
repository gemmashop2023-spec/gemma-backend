import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default supabase;

export async function getAll(table) {
  // Try ordering by common timestamp columns
  let query = supabase.from(table).select('*');
  try {
    const { data, error } = await query.order('creato_il', { ascending: false });
    if (!error) return data;
  } catch(e) {}
  try {
    const { data, error } = await query.order('data', { ascending: false });
    if (!error) return data;
  } catch(e) {}
  // No ordering fallback
  const { data, error } = await supabase.from(table).select('*');
  if (error) throw error;
  return data || [];
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
    await supabase.from('log_sync').insert({ id: 'LOG-' + Date.now(), ...entry });
  } catch(e) {
    console.log('logSync error (non-fatal):', e.message);
  }
}
