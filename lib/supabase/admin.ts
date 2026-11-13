import 'server-only';
import {createClient} from '@supabase/supabase-js';
import {publicConfig} from '../env';
import {ApiError} from '../api/errors';
// Privileged administration and authenticated internal workers use this client.
// Resource data is always queried with the caller's RLS-scoped server client.
export function adminClient(){const {url}=publicConfig();const key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;if(!key)throw new ApiError(503,'SETUP_REQUIRED','Server administration is not configured.');return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})}
