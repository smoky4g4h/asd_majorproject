import {Suspense} from 'react';
import ProductShell from '../components/ProductShell';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
import './globals.css';
import './reference-calendar.css';
import './workspace-layout.css';
import './users-reference.css';
import './documents-reference.css';
import './overview-reference.css';
import './calendar-layout.css';
import './task-board.css';
import './auth.css';
export const metadata={title:'AICTE SecureMeet',description:'Institutional meeting workspace'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body><Suspense fallback={<div className="loading">Preparing your workspace…</div>}><ProductShell>{children}</ProductShell></Suspense></body></html>}
