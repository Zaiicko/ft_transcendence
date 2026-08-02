import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ListNotificationsDto } from './dto/list-notifications.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { NotificationsService } from './notifications.service';

// Everything is private: a notification belongs only to its recipient
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: JwtPayload, @Query() query: ListNotificationsDto) {
    return this.notifications.list(user.sub, query.page, query.limit, query.unread);
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() user: JwtPayload) {
    return this.notifications.unreadCount(user.sub);
  }

  // Per-type preferences (enabled/disabled) — opt-out
  @Get('preferences')
  getPreferences(@CurrentUser() user: JwtPayload) {
    return this.notifications.getPreferences(user.sub);
  }

  @Patch('preferences')
  updatePreferences(@CurrentUser() user: JwtPayload, @Body() dto: UpdatePreferencesDto) {
    return this.notifications.updatePreferences(user.sub, dto as Record<string, boolean>);
  }

  @Patch('read-all')
  @HttpCode(204)
  markAllRead(@CurrentUser() user: JwtPayload) {
    return this.notifications.markAllRead(user.sub);
  }

  // Empties every notification (the "clear" button).
  @Delete()
  @HttpCode(204)
  clearAll(@CurrentUser() user: JwtPayload) {
    return this.notifications.clearAll(user.sub);
  }

  @Patch(':id/read')
  @HttpCode(204)
  markRead(@CurrentUser() user: JwtPayload, @Param('id', ParseIntPipe) id: number) {
    return this.notifications.markRead(user.sub, id);
  }
}
