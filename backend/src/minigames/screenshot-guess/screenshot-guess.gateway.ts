import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtPayload } from '../../auth/auth.service';

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

// Options must be IDENTICAL to the other gateways: Nest shares one Socket.IO
// server per {port, path} — see reviews.gateway.ts for the crash story.
//
// Every authenticated socket joins its own "user:<id>" room, so pushing a
// screenshot-guess match update means emitting into that room — same template as
// NotificationsGateway.
@WebSocketGateway({ path: '/socket.io' })
export class ScreenshotGuessGateway implements OnGatewayConnection {
  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async handleConnection(socket: Socket): Promise<void> {
    try {
      const token = parseCookies(socket.handshake.headers.cookie).access_token;
      if (!token) return; // anonymous: no personal room, the socket lives on
      const payload = await this.jwt.verifyAsync<JwtPayload>(token, {
        secret: this.config.get<string>('JWT_SECRET'),
      });
      await socket.join(`user:${payload.sub}`);
    } catch {
      // invalid or expired token: treated exactly like anonymous
    }
  }

  emitToUser(userId: number, event: string, payload: unknown): void {
    this.server.to(`user:${userId}`).emit(event, payload);
  }
}
