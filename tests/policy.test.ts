import {describe,it,expect} from 'vitest';
import {canManageMembers,canSchedule,canJoinRoom,canAdministerMeeting,isPrivileged,validRedirect,validateMeetingWindow} from '../lib/authz/policy';
const actor={userId:'a',organizationId:'org',role:'ORG_ADMIN' as const,aal:'aal2' as const,active:true};
describe('server authorization decisions',()=>{
 it('requires active membership and MFA for privileged operations',()=>{
  expect(canManageMembers(actor)).toBe(true);
  expect(canManageMembers({...actor,aal:'aal1'})).toBe(false);
  expect(canManageMembers({...actor,active:false})).toBe(false);
  expect(canManageMembers({...actor,role:'MEMBER'})).toBe(false);
  expect(canSchedule({...actor,role:'ORGANIZER'})).toBe(true);
  expect(canSchedule({...actor,role:'RESTRICTED_MEMBER'})).toBe(false);
 });
 it('requires scoped host authority even for administrators',()=>{
  expect(canAdministerMeeting(actor,{organizationId:'org',hostIds:['a']})).toBe(true);
  expect(canAdministerMeeting(actor,{organizationId:'foreign',hostIds:['a']})).toBe(false);
  expect(canAdministerMeeting(actor,{organizationId:'org',hostIds:['b']})).toBe(false);
 });
 it('denies room access when any eligibility condition fails',()=>{
  const eligible={activeMember:true,invited:true,admitted:true,removed:false,meetingLive:true,withinWindow:true};
  expect(canJoinRoom(eligible)).toBe(true);
  for(const key of ['activeMember','invited','admitted','meetingLive','withinWindow'])expect(canJoinRoom({...eligible,[key]:false})).toBe(false);
  expect(canJoinRoom({...eligible,removed:true})).toBe(false);
 });
 it('rejects open redirects including encoded slash/backslash variants',()=>{
  for(const value of ['https://evil.example','//evil.example','/\\evil.example','/%2f%2fevil.example','/%5cevil.example'])expect(validRedirect(value)).toBe('/dashboard');
  expect(validRedirect('/meetings/123')).toBe('/meetings/123');
 });
 it('validates finite chronological meeting times',()=>{
  expect(validateMeetingWindow('2026-11-07T10:00:00Z','2026-11-07T11:00:00Z')).toBe(true);
  expect(validateMeetingWindow('invalid','invalid')).toBe(false);
  expect(validateMeetingWindow('2026-11-07T11:00:00Z','2026-11-07T10:00:00Z')).toBe(false);
  expect(isPrivileged('MEMBER')).toBe(false);
 });
});
