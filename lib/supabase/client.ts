'use client';
import {createBrowserClient} from '@supabase/ssr';
import {publicConfig} from '../env';
let client:ReturnType<typeof createBrowserClient>|undefined;
export function browserClient(){const {url,key}=publicConfig();return client??=createBrowserClient(url,key)}
