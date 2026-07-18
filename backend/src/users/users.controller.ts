import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'crypto';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { hashPassword, verifyPassword } from '../auth/password.util';
import { AVATARS_DIR } from '../common/uploads';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { SetPasswordDto } from './dto/set-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { toPublicUser } from './public-user';
import { UsersService } from './users.service';

const ALLOWED_AVATAR_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // Public profile only — never return passwordHash / twoFactorSecret / providerId
  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const user = await this.usersService.findById(id);
    if (!user) throw new NotFoundException();
    return toPublicUser(user);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me')
  async updateMe(@CurrentUser() current: JwtPayload, @Body() dto: UpdateProfileDto) {
    if (dto.username) {
      const existing = await this.usersService.findByUsername(dto.username);
      if (existing && existing.id !== current.sub) {
        throw new BadRequestException('Username already taken');
      }
    }
    const updated = await this.usersService.update(current.sub, dto);
    return toPublicUser(updated);
  }

  // Provider accounts (Steam/42/Google) have no password: they may set one
  // here to also enable email+password login. Accounts that already have one
  // must prove it before changing it.
  @UseGuards(JwtAuthGuard)
  @Patch('me/password')
  @HttpCode(204)
  async setPassword(@CurrentUser() current: JwtPayload, @Body() dto: SetPasswordDto) {
    const user = await this.usersService.findById(current.sub);
    if (!user) throw new NotFoundException();

    if (user.passwordHash) {
      const valid = dto.currentPassword
        ? await verifyPassword(user.passwordHash, dto.currentPassword)
        : false;
      if (!valid) throw new UnauthorizedException('Incorrect password');
    }

    await this.usersService.update(current.sub, {
      passwordHash: await hashPassword(dto.newPassword),
    });
  }

  @UseGuards(JwtAuthGuard)
  @Delete('me')
  @HttpCode(204)
  async deleteMe(@CurrentUser() current: JwtPayload, @Body() dto: DeleteAccountDto) {
    const user = await this.usersService.findById(current.sub);
    if (!user) throw new NotFoundException();

    if (user.passwordHash) {
      const valid = dto.password ? await verifyPassword(user.passwordHash, dto.password) : false;
      if (!valid) throw new UnauthorizedException('Incorrect password');
    }

    if (user.avatarUrl) await this.usersService.deleteAvatarFile(user.avatarUrl);
    await this.usersService.delete(current.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/avatar')
  @UseInterceptors(
    FileInterceptor('avatar', {
      storage: diskStorage({
        destination: AVATARS_DIR,
        filename: (_req, file, cb) => cb(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`),
      }),
      fileFilter: (_req, file, cb) => cb(null, ALLOWED_AVATAR_MIME_TYPES.has(file.mimetype)),
      limits: { fileSize: MAX_AVATAR_BYTES },
    }),
  )
  async uploadAvatar(@CurrentUser() current: JwtPayload, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Provide a jpeg, png or webp image up to 2MB');

    const user = await this.usersService.findById(current.sub);
    if (user?.avatarUrl) await this.usersService.deleteAvatarFile(user.avatarUrl);

    const updated = await this.usersService.update(current.sub, {
      avatarUrl: `/api/uploads/avatars/${file.filename}`,
    });
    return toPublicUser(updated);
  }
}
