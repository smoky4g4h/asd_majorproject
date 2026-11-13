import type {ActorContext,AppRole} from '../workspace/contracts';
export const isPrivileged=(role:AppRole)=>['PLATFORM_ADMIN','ORG_ADMIN','ORGANIZER'].includes(role);
export const canManageMembers=(a:ActorContext)=>a.active&&a.aal==='aal2'&&['PLATFORM_ADMIN','ORG_ADMIN'].includes(a.role);
export const canSchedule=(a:ActorContext)=>a.active&&a.aal==='aal2'&&isPrivileged(a.role);
export const canAdministerMeeting=(a:ActorContext,m:{organizationId:string;hostIds:string[]})=>a.active&&a.aal==='aal2'&&a.organizationId===m.organizationId&&m.hostIds.includes(a.userId);
export function canJoinRoom(p:{activeMember:boolean;invited:boolean;admitted:boolean;removed:boolean;meetingLive:boolean;withinWindow:boolean}){return p.activeMember&&p.invited&&p.admitted&&!p.removed&&p.meetingLive&&p.withinWindow}
export function validRedirect(value:string|null|undefined){if(!value)return '/dashboard';try{const decoded=decodeURIComponent(value);return decoded.startsWith('/')&&!decoded.startsWith('//')&&!decoded.includes('\\')&&!/[\r\n]/.test(decoded)?value:'/dashboard'}catch{return '/dashboard'}}
export function validateMeetingWindow(start:string,end:string){const a=Date.parse(start),b=Date.parse(end);return Number.isFinite(a)&&Number.isFinite(b)&&b>a&&b-a<=24*60*60*1000}
