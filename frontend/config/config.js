const config = {
    supabaseUrl: String(import.meta.env.VITE_SUPABASE_URL),
    supabaseAnonKey: String(import.meta.env.VITE_SUPABASE_ANON_KEY),
    appTitle: String(import.meta.env.VITE_APP_TITLE),
    defaultAnyDeskAddress: String(import.meta.env.VITE_DEFAULT_ANYDESK_ADDRESS),
    defaultAnyDeskPassword: String(import.meta.env.VITE_DEFAULT_ANYDESK_PASSWORD),
    defaultSupabaseServiceKey: String(import.meta.env.VITE_SUPABASE_SERVICE_KEY)
};

export default config;