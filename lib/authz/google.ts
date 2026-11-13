// Claims must come from Supabase getClaims(), never decoded without verification.
export function hasGoogleAuthentication(claims:Record<string,unknown>,identities:{provider:string}[]=[]){return identities.some(i=>i.provider==='google')&&Array.isArray(claims.amr)&&claims.amr.some((entry:unknown)=>typeof entry==='object'&&entry!==null&&'method' in entry&&entry.method==='oauth')}
