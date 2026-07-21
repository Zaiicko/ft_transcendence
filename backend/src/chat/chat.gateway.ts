import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtPayload } from '../auth/auth.service';

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

// Options IDENTIQUES aux autres gateways : Nest partage un seul serveur
// Socket.IO par {port, path} (cf. reviews.gateway.ts). Chaque socket rejoint sa
// room perso "user:<id>" ; envoyer un message = émettre dans la room du destinataire.
@WebSocketGateway({ path: '/socket.io' })
export class ChatGateway implements OnGatewayConnection {
  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async handleConnection(socket: Socket): Promise<void> {
    try {
      const token = parseCookies(socket.handshake.headers.cookie).access_token;
      if (!token) return;
      const payload = await this.jwt.verifyAsync<JwtPayload>(token, {
        secret: this.config.get<string>('JWT_SECRET'),
      });
      await socket.join(`user:${payload.sub}`);
    } catch {
      // token invalide/expiré : socket anonyme, pas de room perso
    }
  }

  emitToUser(userId: number, event: string, payload: unknown): void {
    this.server.to(`user:${userId}`).emit(event, payload);
  }
}
