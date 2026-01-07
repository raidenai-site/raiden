import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables. ' +
    'Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in frontend/.env.local'
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,           // Explicitly enable session persistence
    storageKey: 'raiden-auth',      // Custom key to avoid conflicts
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    autoRefreshToken: true,         // Auto-refresh expired tokens
    detectSessionInUrl: true,       // For OAuth/magic link flows
  }
})
