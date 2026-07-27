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
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { hashPassword, verifyPassword } from '../auth/password.util';
import { AVATARS_DIR } from '../common/uploads';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { SetPasswordDto } from './dto/set-password.dto';
import { AvatarFrameDto } from './dto/avatar-frame.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { toPublicUser } from './public-user';
import { UsersService } from './users.service';

// image/gif inclus : l'avatar est stocké tel quel (aucun ré-encodage), donc le
// GIF animé est servi et s'anime dans le <img>. 4 Mo reste sous le plafond
// nginx (client_max_body_size 5m), assez pour un GIF d'avatar.
const ALLOWED_AVATAR_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_AVATAR_BYTES = 4 * 1024 * 1024;

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // Public profile page keyed by username: identity, badges, stats and recent
  // activity — privacy-safe (no email). `viewer` (optional auth) only sets the
  // friend-action state. Two path segments, so no clash with @Get(':id').
  @UseGuards(OptionalJwtAuthGuard)
  @Get('profile/:username')
  async publicProfile(@Param('username') username: string, @CurrentUser() viewer?: JwtPayload) {
    const profile = await this.usersService.getPublicProfile(username, viewer?.sub);
    if (!profile) throw new NotFoundException();
    return profile;
  }

  // Full played-games list for the profile's "games played" modal (public,
  // like the profile). Three path segments, so no clash with @Get(':id').
  @Get('profile/:username/played')
  async playedGames(@Param('username') username: string) {
    const rows = await this.usersService.playedGamesOf(username);
    if (rows === null) throw new NotFoundException();
    return rows;
  }

  // Bande de stats « ton année en jeux » sur l'accueil du connecté. Deux
  // segments ⇒ pas de conflit avec @Get(':id'). Réservé au propriétaire (soi).
  @UseGuards(JwtAuthGuard)
  @Get('me/home-stats')
  homeStats(@CurrentUser() current: JwtPayload) {
    return this.usersService.getHomeStats(current.sub);
  }

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

  // Marque le wizard d'onboarding comme terminé (ou explicitement passé) :
  // pose onboardedAt une seule fois. Tant que c'est nul, le front redirige vers
  // /welcome ; une fois posé, plus de redirection auto (on repasse par settings).
  @UseGuards(JwtAuthGuard)
  @Post('me/onboarded')
  async markOnboarded(@CurrentUser() current: JwtPayload) {
    const user = await this.usersService.findById(current.sub);
    if (!user) throw new NotFoundException();
    const updated = user.onboardedAt
      ? user
      : await this.usersService.update(current.sub, { onboardedAt: new Date() });
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
    if (!file) throw new BadRequestException('Provide a jpeg, png, webp or gif image up to 4MB');

    const user = await this.usersService.findById(current.sub);
    if (user?.avatarUrl) await this.usersService.deleteAvatarFile(user.avatarUrl);

    const updated = await this.usersService.update(current.sub, {
      avatarUrl: `/api/uploads/avatars/${file.filename}`,
    });
    return toPublicUser(updated);
  }

  // Zoom/centrage de l'avatar : encodé dans avatarUrl via #af=scale,x,y. Ce
  // fragment n'est jamais envoyé au serveur au fetch de l'image (le navigateur
  // le retire), mais accompagne avatarUrl dans toutes les réponses → le cadrage
  // s'applique sur tous les profils sans dupliquer de champs. Défaut (1,0,0) =
  // pas de fragment (URL propre).
  @UseGuards(JwtAuthGuard)
  @Patch('me/avatar-frame')
  async setAvatarFrame(@CurrentUser() current: JwtPayload, @Body() dto: AvatarFrameDto) {
    const user = await this.usersService.findById(current.sub);
    if (!user?.avatarUrl) throw new BadRequestException('No avatar to frame');
    const base = user.avatarUrl.split('#')[0];
    const framed =
      dto.scale === 1 && dto.x === 0 && dto.y === 0
        ? base
        : `${base}#af=${dto.scale},${dto.x},${dto.y}`;
    const updated = await this.usersService.update(current.sub, { avatarUrl: framed });
    return toPublicUser(updated);
  }
}
