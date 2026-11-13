import {it,expect} from 'vitest';
import {mergeMessages} from '../lib/messaging/messages';
const row={id:'one',author_id:'user',body:'Hi',created_at:'2026-01-01',deleted_at:null,revision:1};
it('does not resurrect deleted content from a delayed response',()=>{const deleted={...row,body:'',deleted_at:'2026-01-02',revision:3};expect(mergeMessages([deleted],[row])).toEqual([deleted])});
it('deduplicates and keeps the newest revision',()=>expect(mergeMessages([row],[{...row,revision:2,body:'Edited'}])).toEqual([{...row,revision:2,body:'Edited'}]));
it('bounds loaded history to the newest 500 messages',()=>expect(mergeMessages([],Array.from({length:600},(_,i)=>({...row,id:String(i).padStart(4,'0')})))).toHaveLength(500));
