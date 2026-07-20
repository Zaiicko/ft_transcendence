import {
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
import { ListGamesDto } from './dto/list-games.dto';
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

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.gamesService.findById(id);
  }

  // "I played it" — public count + the viewer's own mark when authenticated
  @UseGuards(OptionalJwtAuthGuard)
  @Get(':id/played')
  playedStatus(@Param('id', ParseIntPipe) id: number, @CurrentUser() viewer?: JwtPayload) {
    return this.gamesService.playedStatus(id, viewer?.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Put(':id/played')
  markPlayed(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.gamesService.markPlayed(user.sub, id);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id/played')
  @HttpCode(204)
  unmarkPlayed(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.gamesService.unmarkPlayed(user.sub, id);
  }
}
