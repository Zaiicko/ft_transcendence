import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
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
}
