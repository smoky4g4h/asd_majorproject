import {afterEach,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const {createClient}=vi.hoisted(()=>({createClient:vi.fn(()=>({kind:'server-client'}))}));
vi.mock('@supabase/supabase-js',()=>({createClient}));
import {adminClient} from '../lib/supabase/admin';
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks()});
it('accepts the modern server secret without a legacy service-role key',()=>{
 vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://fixture.supabase.co');vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY','public-fixture');vi.stubEnv('SUPABASE_SECRET_KEY','secret-fixture');vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','');
 expect(adminClient()).toEqual({kind:'server-client'});
 expect(createClient).toHaveBeenCalledWith('https://fixture.supabase.co','secret-fixture',{auth:{persistSession:false,autoRefreshToken:false}});
});
