import { createClient } from '@supabase/supabase-js';

let supabase = null;

export function getSupabase() {
  if (supabase) return supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY/SUPABASE_SERVICE_KEY in env');
  }
  supabase = createClient(url, key, { auth: { persistSession: false } });
  return supabase;
}

export async function saveAllLeads(leads) {
  if (!Array.isArray(leads) || !leads.length) return { inserted: 0 };
  const client = getSupabase();
  // Expect table all_leads with columns: lead_id, linkedin_url, bio, scrapped (optional boolean default false)
  const payload = leads.map(l => ({
    lead_id: l.lead_id,
    linkedin_url: l.linkedin_url,
    bio: l.bio,
    scrapped: false
  }));

  const { data, error } = await client.from('all_leads').upsert(payload, { onConflict: 'lead_id' }).select('lead_id');
  if (error) throw error;
  return { inserted: data.length };
}
