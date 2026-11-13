import {it,expect} from 'vitest';
import {reconcileWorkspace} from '../lib/workspace/reconcile';
import type {State} from '../lib/domain';
const original:State={currentUserId:'a',users:[{id:'a',name:'A',active:true,role:'MEMBER',affiliation:'Org'}],meetings:[],tasks:[],documents:[],notifications:[],notes:{}};
it('retains the snapshot identity when a poll returns unchanged data',()=>expect(reconcileWorkspace(original,structuredClone(original))).toBe(original));
it('retains unchanged collections when one field changes',()=>{const next=structuredClone(original);next.notes={one:'updated'};const result=reconcileWorkspace(original,next);expect(result.notes).toBe(next.notes);expect(result.users).toBe(original.users);expect(result.meetings).toBe(original.meetings)});
it('does not reuse another account’s collections',()=>{const next={...structuredClone(original),currentUserId:'b'};expect(reconcileWorkspace(original,next)).toBe(next)});
it('never reuses a previous organization snapshot',()=>{const next={...structuredClone(original),organizationId:'another'};expect(reconcileWorkspace({...original,organizationId:'old'},next)).toBe(next)});
it('updates organization membership even when collections are unchanged',()=>{const next={...structuredClone(original),organizations:[{id:'o',name:'Team',icon:'orange',role:'MEMBER'}]};expect(reconcileWorkspace(original,next).organizations).toEqual(next.organizations)});
