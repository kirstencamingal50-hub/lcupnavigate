import { createClient } from '@supabase/supabase-js';
import { HttpError } from './http.mjs';

let serviceClient;

function options() {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceRoleKey) {
    throw new HttpError(503, 'Supabase is not configured. Set the required Netlify environment variables.');
  }
  return { url, anonKey, serviceRoleKey };
}

export function getPublicClient() {
  const { url, anonKey } = options();
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
}

export function getServiceClient() {
  if (!serviceClient) {
    const { url, serviceRoleKey } = options();
    serviceClient = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
  }
  return serviceClient;
}

export function publicSupabaseConfig() {
  const { url, anonKey } = options();
  return { url, anonKey };
}
