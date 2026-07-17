import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtPayload } from '../../auth/auth.service';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../auth/optional-jwt-auth.guard';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { ReviewCommentsService } from './review-comments.service';

@Controller('comments')
export class CommentsController {
  constructor(private readonly commentsService: ReviewCommentsService) {}

  @UseGuards(OptionalJwtAuthGuard)
  @Get(':id/replies')
  findReplies(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: PaginationDto,
    @CurrentUser() viewer?: JwtPayload,
  ) {
    return this.commentsService.findReplies(id, query.page, query.limit, viewer?.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateCommentDto,
  ) {
    return this.commentsService.update(user.sub, id, dto.text);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.commentsService.remove(user.sub, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/like')
  @HttpCode(204)
  like(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.commentsService.like(user.sub, id);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id/like')
  @HttpCode(204)
  unlike(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.commentsService.unlike(user.sub, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/dislike')
  @HttpCode(204)
  dislike(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.commentsService.dislike(user.sub, id);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id/dislike')
  @HttpCode(204)
  undislike(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.commentsService.undislike(user.sub, id);
  }
}
