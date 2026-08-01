import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PresenceService } from '../presence/presence.service';
import { toPublicUserLite } from '../users/public-user';
import { FriendsService } from './friends.service';

@UseGuards(JwtAuthGuard)
@Controller('friends')
export class FriendsController {
  constructor(
    private readonly friends: FriendsService,
    private readonly presence: PresenceService,
  ) {}

  @Get()
  async list(@CurrentUser() current: JwtPayload) {
    const friends = await this.friends.listFriends(current.sub);
    return friends.map((user) => ({
      ...toPublicUserLite(user),
      isOnline: this.presence.isOnline(user.id),
    }));
  }

  @Get('requests')
  async requests(@CurrentUser() current: JwtPayload) {
    const { incoming, outgoing } = await this.friends.listRequests(current.sub);
    return {
      incoming: incoming.map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        user: toPublicUserLite(r.requester),
      })),
      outgoing: outgoing.map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        user: toPublicUserLite(r.addressee),
      })),
    };
  }

  @Get('suggestions')
  async suggestions(@CurrentUser() current: JwtPayload) {
    const suggested = await this.friends.suggestFriends(current.sub);
    return suggested.map(({ user, via }) => ({ ...toPublicUserLite(user), via }));
  }

  @Post('requests/:username')
  sendRequest(@CurrentUser() current: JwtPayload, @Param('username') username: string) {
    return this.friends.sendRequestByUsername(current.sub, username);
  }

  @Post('requests/:id/accept')
  accept(@CurrentUser() current: JwtPayload, @Param('id', ParseIntPipe) id: number) {
    return this.friends.accept(id, current.sub);
  }

  @Delete('requests/:id')
  @HttpCode(204)
  removeRequest(@CurrentUser() current: JwtPayload, @Param('id', ParseIntPipe) id: number) {
    return this.friends.removeRequest(id, current.sub);
  }

  @Delete(':userId')
  @HttpCode(204)
  unfriend(@CurrentUser() current: JwtPayload, @Param('userId', ParseIntPipe) userId: number) {
    return this.friends.unfriend(current.sub, userId);
  }
}
