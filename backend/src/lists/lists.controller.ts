import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { AddItemDto } from './dto/add-item.dto';
import { CreateListDto } from './dto/create-list.dto';
import { UpdateListDto } from './dto/update-list.dto';
import { ListsService } from './lists.service';

@Controller('lists')
export class ListsController {
  constructor(private readonly lists: ListsService) {}

  // Mes listes (privées comprises)
  @UseGuards(JwtAuthGuard)
  @Get('mine')
  mine(
    @CurrentUser() current: JwtPayload,
    @Query('gameId', new DefaultValuePipe(0), ParseIntPipe) gameId: number,
  ) {
    return this.lists.listMine(current.sub, gameId || undefined);
  }

  // Détail d'une liste — publique pour tous, privée réservée au propriétaire.
  // Guard optionnel : le viewer (si connecté) sert au contrôle d'accès.
  @UseGuards(OptionalJwtAuthGuard)
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() current?: JwtPayload) {
    return this.lists.findOne(id, current?.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@CurrentUser() current: JwtPayload, @Body() dto: CreateListDto) {
    return this.lists.create(current.sub, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  update(
    @CurrentUser() current: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateListDto,
  ) {
    return this.lists.update(current.sub, id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  remove(@CurrentUser() current: JwtPayload, @Param('id', ParseIntPipe) id: number) {
    return this.lists.remove(current.sub, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/items')
  addItem(
    @CurrentUser() current: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddItemDto,
  ) {
    return this.lists.addItem(current.sub, id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id/items/:gameId')
  removeItem(
    @CurrentUser() current: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Param('gameId', ParseIntPipe) gameId: number,
  ) {
    return this.lists.removeItem(current.sub, id, gameId);
  }
}
