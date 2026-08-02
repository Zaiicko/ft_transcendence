import { Injectable } from '@nestjs/common';

// In-memory presence tracking — fine for a single backend container (no horizontal scaling here).
@Injectable()
export class PresenceService {
  private readonly userSockets = new Map<number, Set<string>>();

  // Returns true if this is the user's first open socket (they just came online)
  addSocket(userId: number, socketId: string): boolean {
    const sockets = this.userSockets.get(userId);
    if (!sockets) {
      this.userSockets.set(userId, new Set([socketId]));
      return true;
    }
    sockets.add(socketId);
    return false;
  }

  // Returns true if this was the user's last open socket (they just went offline)
  removeSocket(userId: number, socketId: string): boolean {
    const sockets = this.userSockets.get(userId);
    if (!sockets) return false;
    sockets.delete(socketId);
    if (sockets.size === 0) {
      this.userSockets.delete(userId);
      return true;
    }
    return false;
  }

  isOnline(userId: number): boolean {
    return this.userSockets.has(userId);
  }

  getSocketIds(userId: number): string[] {
    return [...(this.userSockets.get(userId) ?? [])];
  }
}
