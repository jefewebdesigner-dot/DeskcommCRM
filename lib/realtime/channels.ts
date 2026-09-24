/**
 * Compatibilidade histórica.
 *
 * Supabase Realtime não faz parte do backend Neon. Os consumidores ativos usam
 * useRealtimeChannel(), que reconcilia pela API protegida por Auth/RLS.
 */
export function alertsPlatform() {
  return {
    name: "alerts-platform",
  };
}
