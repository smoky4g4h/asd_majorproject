import {it,expect} from 'vitest';
import {meetingTiles} from '../lib/meeting-media/layout';
const camera={participant:{identity:'a'},source:'camera'},share={participant:{identity:'a'},source:'screen_share'},other={participant:{identity:'b'},source:'camera'};
it('makes shared content the leading tile in grid mode',()=>{expect(meetingTiles([camera,other,share],'Grid','',[])).toEqual([share,camera,other])});
it('prefers a selected participant’s shared screen in focus mode',()=>{expect(meetingTiles([camera,other,share],'Focus','a',[])).toEqual([share])});
it('falls back safely when the focused participant leaves',()=>{expect(meetingTiles([other],'Focus','a',[])).toEqual([other])});
it('places the active speaker first without losing other participants',()=>{expect(meetingTiles([camera,other],'Speaker','',['b'])).toEqual([other,camera])});
