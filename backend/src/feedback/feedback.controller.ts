import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { FeedbackStatus } from '@prisma/client';
import { AdminGuard } from '../auth/admin.guard';
import { JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { ReplyFeedbackDto } from './dto/reply-feedback.dto';
import { FeedbackService } from './feedback.service';

// Open to guests too (a bug report shouldn't require an account) — tighter
// than the app-wide default (120/min), same rationale as AUTH_THROTTLE:
// a public write endpoint that emails an admin is exactly what spam targets.
const FEEDBACK_THROTTLE = { default: { limit: 3, ttl: 60_000 } };

@Controller('feedback')
export class FeedbackController {
  constructor(private feedbackService: FeedbackService) {}

  @UseGuards(OptionalJwtAuthGuard)
  @Throttle(FEEDBACK_THROTTLE)
  @Post()
  create(@CurrentUser() user: JwtPayload | undefined, @Body() dto: CreateFeedbackDto) {
    return this.feedbackService.create(user?.sub, dto);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get()
  list(@Query('status') status?: FeedbackStatus) {
    return this.feedbackService.list(status ?? 'OPEN');
  }

  // Declared before ':id/...' for clarity — 'mine' can't collide with a
  // numeric :id anyway.
  @UseGuards(JwtAuthGuard)
  @Get('mine')
  mine(@CurrentUser() user: JwtPayload) {
    return this.feedbackService.myTickets(user.sub);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Patch(':id/resolve')
  resolve(@CurrentUser() admin: JwtPayload, @Param('id', ParseIntPipe) id: number) {
    return this.feedbackService.resolve(admin.sub, id);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Patch(':id/reply')
  reply(@Param('id', ParseIntPipe) id: number, @Body() dto: ReplyFeedbackDto) {
    return this.feedbackService.reply(id, dto.message);
  }

  // Owner-only reply, from their own "My tickets" thread — no AdminGuard.
  @UseGuards(JwtAuthGuard)
  @Patch(':id/messages')
  replyMine(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReplyFeedbackDto,
  ) {
    return this.feedbackService.replyAsOwner(user.sub, id, dto.message);
  }

  // Owner-only "close" — deletes the ticket and its thread.
  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  closeMine(@CurrentUser() user: JwtPayload, @Param('id', ParseIntPipe) id: number) {
    return this.feedbackService.closeAsOwner(user.sub, id);
  }
}
