import { createClient } from "@supabase/supabase-js";

// Cliente server-only, com service role: usado em route handlers (API routes)
// para gravar dados de ingestão sem passar por RLS. Nunca importar no client.
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase não configurado: defina NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY em .env.local"
    );
  }

  return createClient(url, key, {
    auth: { persistSession: false },
  });
}
