import {differenceInCalendarDays,startOfDay} from 'date-fns';
import type {Meeting} from '../domain';
/** Split overnight meetings into day segments, and give overlaps equal readable lanes. */
export function calendarSegments(meetings:Meeting[],day:Date){
 const start=startOfDay(day).getTime(),end=new Date(day.getFullYear(),day.getMonth(),day.getDate()+1).getTime();
 const items=meetings.filter(m=>m.state!=='CANCELLED'&&Date.parse(m.startAt)<end&&Date.parse(m.endAt)>start).map(meeting=>({meeting,start:Math.max(start,Date.parse(meeting.startAt)),end:Math.min(end,Date.parse(meeting.endAt)),lane:0,lanes:1})).sort((a,b)=>a.start-b.start||a.end-b.end);
 let cluster:typeof items=[],ends:number[]=[],clusterEnd=0;
 function finish(){for(const item of cluster)item.lanes=ends.length;cluster=[];ends=[];}
 for(const item of items){if(item.start>=clusterEnd)finish();let lane=ends.findIndex(end=>end<=item.start);if(lane<0)lane=ends.length;item.lane=lane;ends[lane]=item.end;cluster.push(item);clusterEnd=Math.max(clusterEnd,item.end)}finish();
 return items.map(item=>({...item,top:(new Date(item.start).getHours()+new Date(item.start).getMinutes()/60)*73,height:Math.max(28,(item.end-item.start)/3600000*73)}));
}
export const meetingOnDate=(meeting:Meeting,date:Date)=>differenceInCalendarDays(new Date(meeting.startAt),date)===0;
