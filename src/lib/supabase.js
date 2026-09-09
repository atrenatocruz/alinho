import { createClient } from '@supabase/supabase-js'

// Exportado porque o link "Adicionar ao calendario" (Trello #206) aponta
// para a edge function game-ics, no mesmo projeto Supabase.
export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Supabase configuration missing. Please check your .env file.')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)


