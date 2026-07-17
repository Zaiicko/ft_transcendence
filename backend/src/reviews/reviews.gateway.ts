import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

// Rooms are named "game:<id>" — every browser tab currently viewing a game's
// page sits in that game's room and receives its review events.
@WebSocketGateway()
export class ReviewsGateway {
  @WebSocketServer()
  server: Server;

  @SubscribeMessage('game:join')
  handleJoinGame(@ConnectedSocket() client: Socket, @MessageBody() gameId: number) {
    if (!Number.isInteger(gameId) || gameId <= 0) return;
    // One watched game per client: leave any previous game room first
    for (const room of client.rooms) {
      if (room.startsWith('game:')) client.leave(room);
    }
    client.join(`game:${gameId}`);
  }

  // Called by ReviewsService / ReviewCommentsService after each mutation
  emitToGame(gameId: number, event: string, payload: unknown) {
    this.server.to(`game:${gameId}`).emit(event, payload);
  }
}
