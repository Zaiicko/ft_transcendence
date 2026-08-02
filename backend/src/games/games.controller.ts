import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { GetGameDto } from './dto/get-game.dto';
import { ListGamesDto } from './dto/list-games.dto';
import { MarkDateDto } from './dto/mark-date.dto';
import { SearchGamesDto } from './dto/search-games.dto';
import { GamesService } from './games.service';

@Controller('games')
export class GamesController {
  constructor(private readonly gamesService: GamesService) {}

  @Get()
  list(@Query() query: ListGamesDto) {
    return this.gamesService.list(query);
  }

  // Declared before ':id' so "search" is not parsed as an id.
  // Default = local autocomplete; add &igdb=true (explicit user action)
  // to import missing games from IGDB on the fly.
  @Get('search')
  search(@Query() query: SearchGamesDto) {
    return this.gamesService.search(query.q, query.igdb);
  }

  // Declared before ':id' so "facets" is not parsed as an id.
  @Get('facets')
  facets() {
    return this.gamesService.facets();
  }

  // Declared before ':id' so "recommendations" is not parsed as an id.
  // Personalized, so it requires auth — genres come from the caller's own
  // reviews/played games.
  @UseGuards(JwtAuthGuard)
  @Get('recommendations')
  recommendations(@CurrentUser() user: JwtPayload) {
    return this.gamesService.recommendationsFor(user.sub);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @Query() query: GetGameDto) {
    return this.gamesService.findById(id, query.lang);
  }

  // "I played it" — public count + the viewer's own mark when authenticated
  @UseGuards(OptionalJwtAuthGuard)
  @Get(':id/played')
  playedStatus(@Param('id', ParseIntPipe) id: number, @CurrentUser() viewer?: JwtPayload) {
    return this.gamesService.playedStatus(id, viewer?.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Put(':id/played')
  markPlayed(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
    @Body() body: MarkDateDto,
  ) {
    return this.gamesService.markPlayed(user.sub, id, body.date ? new Date(body.date) : undefined);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id/played')
  @HttpCode(204)
  unmarkPlayed(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.gamesService.unmarkPlayed(user.sub, id);
  }

  // Manual "completed": feeds the green calendar and the activity feed
  @UseGuards(JwtAuthGuard)
  @Put(':id/completed')
  markCompleted(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
    @Body() body: MarkDateDto,
  ) {
    return this.gamesService.markCompleted(user.sub, id, body.date ? new Date(body.date) : undefined);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id/completed')
  @HttpCode(204)
  unmarkCompleted(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.gamesService.unmarkCompleted(user.sub, id);
  }
}
