import { createClient } from '@supabase/supabase-js';

// This creates the connection to your Supabase project
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
