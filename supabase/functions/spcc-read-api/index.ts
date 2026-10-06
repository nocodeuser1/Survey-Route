import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { makeHandler } from './core.js';
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: {persistSession:false} });
// Deploy with --no-verify-jwt: export authenticates its hashed, account-scoped key;
// key management independently verifies the user's JWT with Auth.getUser.
Deno.serve(makeHandler({db,enabled:Deno.env.get('SPCC_READ_API_ENABLED')==='true'}));
