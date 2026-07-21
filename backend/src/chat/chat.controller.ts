import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ChatService } from './chat.service';
import { SendMessageDto } from './dto/send-message.dto';

@UseGuards(JwtAuthGuard)
@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  // Liste des conversations (amis + dernier message + non-lus + en ligne)
  @Get('conversations')
  conversations(@CurrentUser() current: JwtPayload) {
    return this.chat.listConversations(current.sub);
  }

  // Total de messages non lus (pastille de la bulle de chat)
  @Get('unread-count')
  unread(@CurrentUser() current: JwtPayload) {
    return this.chat.unreadCount(current.sub);
  }

  // Fil avec un ami (marque comme lu). Deux segments : pas de clash avec les GET ci-dessus.
  @Get('with/:userId')
  thread(
    @CurrentUser() current: JwtPayload,
    @Param('userId', ParseIntPipe) userId: number,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(30), ParseIntPipe) limit: number,
  ) {
    return this.chat.getThread(current.sub, userId, page, Math.min(Math.max(limit, 1), 50));
  }

  @Post()
  send(@CurrentUser() current: JwtPayload, @Body() dto: SendMessageDto) {
    return this.chat.send(current.sub, dto);
  }

  @Post('with/:userId/read')
  @HttpCode(200)
  read(@CurrentUser() current: JwtPayload, @Param('userId', ParseIntPipe) userId: number) {
    return this.chat.markRead(current.sub, userId);
  }
}
