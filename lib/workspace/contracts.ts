export type AppRole='PLATFORM_ADMIN'|'ORG_ADMIN'|'ORGANIZER'|'MEMBER'|'RESTRICTED_MEMBER';
export type ActorContext={userId:string;organizationId:string;role:AppRole;aal:'aal1'|'aal2';active:boolean};
export type ApiResult<T>={data:T;error:null}|{data:null;error:{code:string;message:string}};
export type MeetingRole='HOST'|'COHOST'|'ATTENDEE';
