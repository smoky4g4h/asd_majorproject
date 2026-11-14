import {it,expect} from 'vitest';
import {calendarSegments} from '../lib/workspace/calendar';
import type {Meeting} from '../lib/domain';
const day=new Date(2026,10,9),at=(hour:number)=>new Date(2026,10,9,hour).toISOString();
const m=(id:string,start:number,end:number):Meeting=>({id,title:id,description:'',organizerId:'a',participantIds:['a'],startAt:at(start),endAt:at(end),state:'SCHEDULED',agenda:[],rsvp:{}});
it('splits overlapping meetings into lanes without bleeding across dates',()=>{const result=calendarSegments([m('a',9,11),m('b',10,12),m('c',12,13),m('d',33,34)],day);expect(result.map(x=>[x.meeting.id,x.lane,x.lanes])).toEqual([['a',0,2],['b',1,2],['c',0,1]]);});
it('splits overnight meetings and excludes cancelled meetings',()=>{const overnight=m('a',23,26);expect(calendarSegments([overnight],day)[0].height).toBe(73);expect(calendarSegments([overnight],new Date(2026,10,10))[0].height).toBe(146);expect(calendarSegments([{...overnight,state:'CANCELLED'}],day)).toEqual([]);});
