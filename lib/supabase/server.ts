import 'server-only';
import {createServerClient} from '@supabase/ssr';
import {cookies} from 'next/headers';
import {publicConfig} from '../env';
import {ApiError} from '../api/errors';
export async function serverClient(){let config;try{config=publicConfig()}catch{throw new ApiError(503,'SETUP_REQUIRED','Connect Supabase to open this workspace. Configure the environment and apply the database migrations.')}const jar=await cookies();return createServerClient(config.url,config.key,{cookies:{getAll:()=>jar.getAll(),setAll(values){for(const {name,value,options} of values)jar.set(name,value,options)}}})}
