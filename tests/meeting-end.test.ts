import {it,expect,vi} from 'vitest';
import {closeMediaRoom} from '../lib/meeting-media/lifecycle';
import {ServerError} from 'livekit-server-sdk';
const service=()=>({listParticipants:vi.fn(async()=>[{identity:'connected'}]),removeParticipant:vi.fn(async(..._args:any[])=>{}),deleteRoom:vi.fn(async()=>{})});
it('revokes cached tokens for connected and previously departed members before deleting',async()=>{const client=service();await closeMediaRoom(client as any,'room',['departed','connected']);expect(client.removeParticipant.mock.calls.map(call=>call[1])).toEqual(['departed','connected']);expect(client.deleteRoom).toHaveBeenCalledWith('room')});
it('does not report room closed when revocation fails',async()=>{const client=service();client.removeParticipant.mockRejectedValue(new Error('unavailable'));await expect(closeMediaRoom(client as any,'room',['departed'])).rejects.toThrow();expect(client.deleteRoom).not.toHaveBeenCalled()});
it('still revokes departed-member tokens if the room already disappeared',async()=>{const client=service();client.listParticipants.mockRejectedValue(new ServerError('absent','absent',404,'not_found'));client.deleteRoom.mockRejectedValue(new ServerError('absent','absent',404,'not_found'));await closeMediaRoom(client as any,'room',['departed']);expect(client.removeParticipant).toHaveBeenCalledTimes(1)});
