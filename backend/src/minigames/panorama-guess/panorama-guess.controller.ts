import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtPayload } from '../../auth/auth.service';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PanoramaGuessService } from './panorama-guess.service';
import { CreatePanoramaGuessMatchDto } from './dto/create-match.dto';
import { GuessPanoramaGuessDto } from './dto/guess.dto';
import { RespondPanoramaGuessDto } from './dto/respond.dto';
import { RoundQueryDto } from './dto/round-query.dto';

@UseGuards(JwtAuthGuard)
@Controller('minigames/panorama-guess')
export class PanoramaGuessController {
  constructor(private readonly service: PanoramaGuessService) {}

  // LOCAL mode: entirely client-driven, this is the only server involvement —
  // picking an entry and, below, validating each guess against it.
  @Get('round')
  pickLocalRound(@Query() query: RoundQueryDto) {
    return this.service.pickLocalRound(query.exclude);
  }

  @Post('round/:token/guess')
  guessLocal(@Param('token') token: string, @Body() dto: GuessPanoramaGuessDto) {
    return this.service.guessLocal(token, dto.catalogId ?? null);
  }

  // MULTI mode
  @Post('matches')
  createMatch(@CurrentUser() user: JwtPayload, @Body() dto: CreatePanoramaGuessMatchDto) {
    return this.service.createMatch(user.sub, dto);
  }

  @Get('matches/:id')
  getState(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.service.getState(id, user.sub);
  }

  @Post('matches/:id/respond')
  respond(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: RespondPanoramaGuessDto) {
    return this.service.respond(id, user.sub, dto.accept);
  }

  @Post('matches/:id/start')
  start(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.service.start(id, user.sub);
  }

  @Post('matches/:id/guess')
  guess(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: GuessPanoramaGuessDto) {
    return this.service.guess(id, user.sub, dto.catalogId ?? null);
  }

  @Post('matches/:id/leave')
  @HttpCode(204)
  leave(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.service.leave(id, user.sub);
  }
}
