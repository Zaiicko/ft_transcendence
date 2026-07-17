import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import { ListGamesDto } from './dto/list-games.dto';
import { SearchGamesDto } from './dto/search-games.dto';
import { GamesService } from './games.service';

@Controller('games')
export class GamesController {
  constructor(private readonly gamesService: GamesService) {}

  @Get()
  list(@Query() query: ListGamesDto) {
    return this.gamesService.list(query.page, query.limit);
  }

  // Declared before ':id' so "search" is not parsed as an id.
  // Default = local autocomplete; add &igdb=true (explicit user action)
  // to import missing games from IGDB on the fly.
  @Get('search')
  search(@Query() query: SearchGamesDto) {
    return this.gamesService.search(query.q, query.igdb);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.gamesService.findById(id);
  }
}
