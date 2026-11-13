import type {State} from '../domain';

/** Snapshots are JSON. Reuse unchanged collections so polling does not repaint the UI. */
export function reconcileWorkspace(previous:State,next:State):State {
 if(previous.currentUserId!==next.currentUserId||previous.organizationId!==next.organizationId)return next;
 const result={...next};
 let changed=false;
 for(const key of ['organizations','users','meetings','documents','tasks','notifications','notes'] as const){
  if(JSON.stringify(previous[key])===JSON.stringify(next[key]))Object.assign(result,{[key]:previous[key]});
  else changed=true;
 }
 return changed?result:previous;
}
