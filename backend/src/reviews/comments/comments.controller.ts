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
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { ReviewCommentsService } from './review-comments.service';

@Controller('comments')
export class CommentsController {
  constructor(private readonly commentsService: ReviewCommentsService) {}

  @Get(':id/replies')
  findReplies(
    @Param('id', ParseIntPipe) id: number,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 20,
  ) {
    return this.commentsService.findReplies(id, page, limit);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: { id: number },
    @Body() dto: UpdateCommentDto,
  ) {
    return this.commentsService.update(user.id, id, dto.text);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: { id: number }) {
    return this.commentsService.remove(user.id, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/like')
  @HttpCode(204)
  like(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: { id: number }) {
    return this.commentsService.like(user.id, id);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id/like')
  @HttpCode(204)
  unlike(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: { id: number }) {
    return this.commentsService.unlike(user.id, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/dislike')
  @HttpCode(204)
  dislike(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: { id: number }) {
    return this.commentsService.dislike(user.id, id);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id/dislike')
  @HttpCode(204)
  undislike(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: { id: number }) {
    return this.commentsService.undislike(user.id, id);
  }
}
