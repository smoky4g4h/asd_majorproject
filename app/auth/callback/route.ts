import {NextResponse} from 'next/server';
import {serverClient} from '../../../lib/supabase/server';
import {verifiedSession} from '../../../lib/auth/session';
import {appOrigin} from '../../../lib/env';
import {validRedirect} from '../../../lib/authz/policy';
export async function GET(request:Request){const url=new URL(request.url);const next=validRedirect(url.searchParams.get('next'));let valid=false;try{const code=url.searchParams.get('code');if(code){const db=await serverClient();const {error}=await db.auth.exchangeCodeForSession(code);if(!error){await verifiedSession();valid=true}}}catch{/* Provider errors/tokens are never echoed. Password, recovery and invitation sessions cannot enter the workspace. */}const response=NextResponse.redirect(new URL(valid?next:'/login?error=invalid-link',appOrigin()));response.headers.set('Cache-Control','private, no-store');response.headers.set('Referrer-Policy','no-referrer');return response}
