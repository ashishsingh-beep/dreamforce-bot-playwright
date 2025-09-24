import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

let supabase = null;
if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
}

export async function saveToLeadDetails(lead) {
  if (!supabase) {
    console.warn('Supabase not configured; skipping save');
    return { skipped: true };
  }
  // Ensure fields per schema
  const row = {
    lead_id: lead.lead_id ?? null,
    name: lead.name ?? null,
    title: lead.title ?? null,
    location: lead.location ?? null,
    profile_url: lead.profile_url ?? null,
    bio: lead.bio ?? null,
    skills: lead.skills ?? [],
    experience: lead.experience ?? null,
    company_name: lead.company_name ?? null,
    company_page_url: lead.company_page_url ?? null,
  };
  const { error } = await supabase.from('lead_details').insert(row);
  if (error) throw error;

  // Mark scrapped true in all_leads (column name confirmed as 'scrapped')
  if (row.lead_id) {
    try {
      const { error: updErr, data } = await supabase
        .from('all_leads')
        .update({ scrapped: true })
        .eq('lead_id', row.lead_id)
        .select('lead_id');
      if (updErr) {
        console.warn('Failed to update all_leads.scrapped for', row.lead_id, updErr.message);
      } else if (!data || data.length === 0) {
        console.warn('No matching row in all_leads for lead_id=', row.lead_id);
      } else {
        console.log(`Marked all_leads.scrapped=true for lead_id=${row.lead_id}`);
      }
    } catch (e) {
      console.warn('Unexpected error updating all_leads.scrapped', e.message);
    }
  }

  return { inserted: true };
}
