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

// Doubles as the extension whitelist — see the note on AVATAR_EXT_BY_MIME in
// users.controller.ts: deriving the stored name from file.originalname would let
// a client serve arbitrary HTML/JS from our origin under /api/uploads.
const COVER_EXT_BY_MIME = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
]);
const MAX_COVER_BYTES = 4 * 1024 * 1024;

@Controller('lists')
export class ListsController {
  constructor(private readonly lists: ListsService) {}

  // Cover image, any format including animated GIF, stored as-is.
  @UseGuards(JwtAuthGuard)
  @Post(':id/cover')
  @UseInterceptors(
    FileInterceptor('cover', {
      storage: diskStorage({
        destination: LIST_COVERS_DIR,
        // fileFilter runs first, so the mime type is always one of the four.
        filename: (_req, file, cb) =>
          cb(null, `${randomUUID()}${COVER_EXT_BY_MIME.get(file.mimetype) ?? ''}`),
      }),
      fileFilter: (_req, file, cb) => cb(null, COVER_EXT_BY_MIME.has(file.mimetype)),
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

  // Cover zoom/centering, encoded in coverUrl as #af=scale,x,y.
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

  // My lists, private ones included
  @UseGuards(JwtAuthGuard)
  @Get('mine')
  mine(
    @CurrentUser() current: JwtPayload,
    @Query('gameId', new DefaultValuePipe(0), ParseIntPipe) gameId: number,
  ) {
    return this.lists.listMine(current.sub, gameId || undefined);
  }

  // List detail: public to everyone, private to its owner. The optional guard
  // supplies the viewer, when signed in, for the access check.
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
