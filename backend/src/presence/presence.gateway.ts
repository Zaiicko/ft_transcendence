import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { FriendshipStatus } from '@prisma/client';
import { Server, Socket } from 'socket.io';
import { JwtPayload } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { PresenceService } from './presence.service';

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    out[part.slice(0, separator).trim()] = decodeURIComponent(part.slice(separator + 1).trim());
  }
  return out;
}

// Mounted at /socket.io, matching the location nginx already proxies with upgrade headers.
@WebSocketGateway({ path: '/socket.io' })
export class PresenceGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(PresenceGateway.name);

  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly presence: PresenceService,
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async handleConnection(socket: Socket): Promise<void> {
    const userId = await this.authenticate(socket);
    if (userId === null) {
      // The Socket.IO server is shared with ReviewsGateway, whose rooms are
      // public (anonymous browsing) — keep the socket, just don't track it
      return;
    }
    socket.data.userId = userId;

    if (this.presence.addSocket(userId, socket.id)) {
      await this.broadcastToFriends(userId, 'friend:online', { userId });
    }
  }

  async handleDisconnect(socket: Socket): Promise<void> {
    const userId = socket.data.userId as number | undefined;
    if (userId === undefined) return;

    if (this.presence.removeSocket(userId, socket.id)) {
      // updateMany, not update: a socket can disconnect for a user deleted in
      // the meantime. update would throw P2025 and, unhandled here, take the
      // whole backend down; updateMany simply matches no row.
      await this.prisma.user.updateMany({ where: { id: userId }, data: { lastSeenAt: new Date() } });
      await this.broadcastToFriends(userId, 'friend:offline', { userId });
    }
  }

  private async authenticate(socket: Socket): Promise<number | null> {
    try {
      const token = parseCookies(socket.handshake.headers.cookie).access_token;
      if (!token) return null;
      const payload = await this.jwt.verifyAsync<JwtPayload>(token, {
        secret: this.config.get<string>('JWT_SECRET'),
      });
      return payload.sub;
    } catch (err) {
      this.logger.debug(`WebSocket auth rejected: ${(err as Error).message}`);
      return null;
    }
  }

  private async broadcastToFriends(userId: number, event: string, payload: unknown): Promise<void> {
    const friendships = await this.prisma.friendship.findMany({
      where: {
        status: FriendshipStatus.ACCEPTED,
        OR: [{ requesterId: userId }, { addresseeId: userId }],
      },
      select: { requesterId: true, addresseeId: true },
    });

    for (const { requesterId, addresseeId } of friendships) {
      const friendId = requesterId === userId ? addresseeId : requesterId;
      for (const socketId of this.presence.getSocketIds(friendId)) {
        this.server.to(socketId).emit(event, payload);
      }
    }
  }
}
