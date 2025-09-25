import { createClient } from '@supabase/supabase-js';
import config from '../../config/config';

const supabaseUrl = config.supabaseUrl;
const supabaseAnonKey = config.supabaseAnonKey;
const supabaseServiceKey = config.defaultSupabaseServiceKey; // Use service role key ONLY on server side!

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);


