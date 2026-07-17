import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

// A review target is either a game or a company (studio) page. Rooms are
// named "game:<id>" / "company:<id>" — every browser tab currently viewing
// that page sits in the room and receives its review events.
export type ReviewTarget = { gameId: number | null; companyId: number | null };

@WebSocketGateway()
export class ReviewsGateway {
  @WebSocketServer()
  server: Server;

  @SubscribeMessage('game:join')
  handleJoinGame(@ConnectedSocket() client: Socket, @MessageBody() gameId: number) {
    this.joinRoom(client, 'game', gameId);
  }

  @SubscribeMessage('company:join')
  handleJoinCompany(@ConnectedSocket() client: Socket, @MessageBody() companyId: number) {
    this.joinRoom(client, 'company', companyId);
  }

  // One watched page per client: joining a room leaves any previous one
  private joinRoom(client: Socket, kind: 'game' | 'company', id: number) {
    if (!Number.isInteger(id) || id <= 0) return;
    for (const room of client.rooms) {
      if (room.startsWith('game:') || room.startsWith('company:')) client.leave(room);
    }
    client.join(`${kind}:${id}`);
  }

  // Called by ReviewsService / ReviewCommentsService after each mutation
  emitToTarget(target: ReviewTarget, event: string, payload: unknown) {
    const room = target.gameId ? `game:${target.gameId}` : `company:${target.companyId}`;
    this.server.to(room).emit(event, payload);
  }
}
