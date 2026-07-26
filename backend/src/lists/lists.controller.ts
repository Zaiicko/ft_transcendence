import {
  BadRequestException,
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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'crypto';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { LIST_COVERS_DIR } from '../common/uploads';
import { AddItemDto } from './dto/add-item.dto';
import { CoverFrameDto } from './dto/cover-frame.dto';
import { CreateListDto } from './dto/create-list.dto';
import { ReorderListDto } from './dto/reorder-list.dto';
import { UpdateListDto } from './dto/update-list.dto';
import { ListsService } from './lists.service';

const ALLOWED_COVER_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_COVER_BYTES = 4 * 1024 * 1024;

@Controller('lists')
export class ListsController {
  constructor(private readonly lists: ListsService) {}

  // Image de couverture (tous formats dont GIF animé, stockée telle quelle).
  @UseGuards(JwtAuthGuard)
  @Post(':id/cover')
  @UseInterceptors(
    FileInterceptor('cover', {
      storage: diskStorage({
        destination: LIST_COVERS_DIR,
        filename: (_req, file, cb) =>
          cb(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`),
      }),
      fileFilter: (_req, file, cb) => cb(null, ALLOWED_COVER_MIME_TYPES.has(file.mimetype)),
      limits: { fileSize: MAX_COVER_BYTES },
    }),
  )
  uploadCover(
    @CurrentUser() current: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Provide a jpeg, png, webp or gif image up to 4MB');
    return this.lists.setCover(current.sub, id, `/api/uploads/list-covers/${file.filename}`);
  }

  // Zoom/centrage de la couverture (encodé dans coverUrl via #af=scale,x,y).
  @UseGuards(JwtAuthGuard)
  @Patch(':id/cover-frame')
  setCoverFrame(
    @CurrentUser() current: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CoverFrameDto,
  ) {
    return this.lists.setCoverFrame(current.sub, id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id/cover')
  removeCover(@CurrentUser() current: JwtPayload, @Param('id', ParseIntPipe) id: number) {
    return this.lists.removeCover(current.sub, id);
  }

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
  @Patch(':id/order')
  reorder(
    @CurrentUser() current: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReorderListDto,
  ) {
    return this.lists.reorder(current.sub, id, dto.gameIds);
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
