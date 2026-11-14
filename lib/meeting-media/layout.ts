type Tile={participant:{identity:string};source:string};
/** Stable tile ordering: presentation first; focus survives departures without an empty stage. */
export function meetingTiles<T extends Tile>(tracks:T[],layout:string,focus:string,speakers:string[]):T[]{
 const focused=tracks.filter(track=>track.participant.identity===focus);
 const sharing=tracks.find(track=>track.source==='screen_share');
 const selected=(layout==='Focus'?(focused.find(track=>track.source==='screen_share')||focused[0]):undefined)||sharing||tracks.find(track=>track.participant.identity===speakers[0])||tracks[0];
 if(!selected)return [];
 if(layout==='Focus')return [selected];
 if(layout==='Speaker'||sharing)return [selected,...tracks.filter(track=>track!==selected)];
 return tracks;
}
