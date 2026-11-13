import {expect,it} from 'vitest';
import {hasGoogleAuthentication} from '../lib/authz/google';
it('rejects password or invitation sessions even for a linked Google account',()=>{
 const identities=[{provider:'google'}];
 expect(hasGoogleAuthentication({amr:[{method:'password'}]},identities)).toBe(false);
 expect(hasGoogleAuthentication({amr:[{method:'invite'}]},identities)).toBe(false);
 expect(hasGoogleAuthentication({amr:[{method:'oauth'},{method:'totp'}]},identities)).toBe(true);
 expect(hasGoogleAuthentication({amr:[{method:'oauth'}]},[{provider:'github'}])).toBe(false);
 expect(hasGoogleAuthentication({},identities)).toBe(false);
});
