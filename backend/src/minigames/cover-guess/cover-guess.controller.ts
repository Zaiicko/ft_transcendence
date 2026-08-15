import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtPayload } from '../../auth/auth.service';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { CoverGuessService } from './cover-guess.service';
import { CreateCoverGuessMatchDto } from './dto/create-match.dto';
import { GuessCoverGuessDto } from './dto/guess.dto';
import { RespondCoverGuessDto } from './dto/respond.dto';
import { RoundQueryDto } from './dto/round-query.dto';

@UseGuards(JwtAuthGuard)
@Controller('minigames/cover-guess')
export class CoverGuessController {
  constructor(private readonly service: CoverGuessService) {}

  // LOCAL mode: entirely client-driven, this is the only server involvement —
  // picking a game and, below, validating each guess against it.
  @Get('round')
  pickLocalRound(@Query() query: RoundQueryDto) {
    return this.service.pickLocalRound(query.difficulty, query.exclude);
  }

  @Post('round/:token/guess')
  guessLocal(@Param('token') token: string, @Body() dto: GuessCoverGuessDto) {
    return this.service.guessLocal(token, dto.catalogId ?? null);
  }

  // MULTI mode
  @Post('matches')
  createMatch(@CurrentUser() user: JwtPayload, @Body() dto: CreateCoverGuessMatchDto) {
    return this.service.createMatch(user.sub, dto);
  }

  @Get('matches/:id')
  getState(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.service.getState(id, user.sub);
  }

  @Post('matches/:id/respond')
  respond(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: RespondCoverGuessDto) {
    return this.service.respond(id, user.sub, dto.accept);
  }

  @Post('matches/:id/start')
  start(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.service.start(id, user.sub);
  }

  @Post('matches/:id/guess')
  guess(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: GuessCoverGuessDto) {
    return this.service.guess(id, user.sub, dto.catalogId ?? null);
  }

  @Post('matches/:id/leave')
  @HttpCode(204)
  leave(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.service.leave(id, user.sub);
  }
}
