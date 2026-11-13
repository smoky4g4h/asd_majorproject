import nextEnv from '@next/env';
import { createHash, randomBytes } from 'node:crypto';

nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const env = process.env;
if (env.SUPABASE_PROJECT_REF !== 'mftyekqjrhwdtckskpps') throw Error('Unexpected development target.');
const base = env.NEXT_PUBLIC_SUPABASE_URL;
const headers = { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY };
const settingsResponse = await fetch(`${base}/auth/v1/settings`, { headers, signal: AbortSignal.timeout(20000) });
if (!settingsResponse.ok) throw Error(`Auth settings HTTP ${settingsResponse.status}`);
const settings = await settingsResponse.json();
const providers = Object.entries(settings.external ?? {}).filter(([, enabled]) => enabled).map(([name]) => name);
if (providers.length !== 1 || providers[0] !== 'google' || !settings.disable_signup) {
  throw Error('Expected only Google enabled with public signup disabled.');
}
console.log('Public Auth settings verified: only Google enabled; public signup disabled.');
const authorize = new URL(`${base}/auth/v1/authorize`);
authorize.searchParams.set('provider', 'google');
authorize.searchParams.set('redirect_to', `${env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/dashboard`);
authorize.searchParams.set('code_challenge', createHash('sha256').update(randomBytes(32).toString('base64url')).digest('base64url'));
authorize.searchParams.set('code_challenge_method', 's256');
const response = await fetch(authorize, { headers, redirect: 'manual', signal: AbortSignal.timeout(20000) });
const location = response.headers.get('location');
if (response.status !== 302 || !location) throw Error(`OAuth redirect HTTP ${response.status}`);
const destination = new URL(location);
if (destination.hostname !== 'accounts.google.com' || destination.searchParams.get('client_id') !== env.GOOGLE_CLIENT_ID || destination.searchParams.get('redirect_uri') !== `${base}/auth/v1/callback`) {
  throw Error('OAuth redirect destination or client mismatch.');
}
console.log('OAuth initiation verified: HTTP 302 to Google with the configured client and Supabase callback.');
console.log('Account consent, code exchange, identity linking and MFA still require an interactive sign-in.');
