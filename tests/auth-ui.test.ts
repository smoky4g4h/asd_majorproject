import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it,vi} from 'vitest';

const {route}=vi.hoisted(()=>({route:{path:'/login'}}));
vi.mock('next/navigation',()=>({usePathname:()=>route.path}));
vi.mock('../lib/supabase/client',()=>({browserClient:()=>{throw new Error('Service must not initialize during rendering')}}));
import AuthScreen,{authenticatorQrSource} from '../components/AuthScreen';

describe('authentication boundaries',()=>{
 it('shows setup guidance without offering fake identity or login',()=>{
  const html=renderToStaticMarkup(React.createElement(AuthScreen,{setup:true,onAuthenticated:()=>{}}));
  expect(html).toContain('Workspace setup required');
  expect(html).not.toContain('<input');
  expect(html).not.toContain('Choose profile');
 });
 it('does not offer public registration on login',()=>{
  route.path='/login';
  const html=renderToStaticMarkup(React.createElement(AuthScreen,{onAuthenticated:()=>{}}));
  expect(html).toContain('Sign in');
  expect(html).toContain('Invitation-only access');
  expect(html).not.toContain('Sign up');
 });
 it('offers Google only and no password or recovery flow',()=>{
  const html=renderToStaticMarkup(React.createElement(AuthScreen,{onAuthenticated:()=>{}}));
  expect(html).toContain('Continue with Google');
  expect(html).not.toContain('type="password"');
  expect(html).not.toContain('Forgot password');
 });
 it('accepts provider SVG QR data only as an image source',()=>{
  expect(authenticatorQrSource('data:image/svg+xml;utf-8,<svg/>')).toBe('data:image/svg+xml;utf-8,<svg/>');
  expect(authenticatorQrSource('javascript:alert(1)')).toBe('');
  expect(authenticatorQrSource('https://untrusted.example/qr.svg')).toBe('');
 });
});
