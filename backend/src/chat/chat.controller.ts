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

  // Conversation list: friends with last message, unread count and presence
  @Get('conversations')
  conversations(@CurrentUser() current: JwtPayload) {
    return this.chat.listConversations(current.sub);
  }

  // Total unread messages, for the chat bubble badge
  @Get('unread-count')
  unread(@CurrentUser() current: JwtPayload) {
    return this.chat.unreadCount(current.sub);
  }

  // Thread with a friend; marks it read. Two segments, so no clash with the GETs above.
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
