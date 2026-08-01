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
  Res,
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { randomUUID } from 'crypto';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { hashPassword, verifyPassword } from '../auth/password.util';
import { AVATARS_DIR } from '../common/uploads';
import { MailerService } from '../mailer/mailer.service';
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
  constructor(
    private readonly usersService: UsersService,
    private readonly mailer: MailerService,
  ) {}

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

  // Marque le tour guidé comme vu (ou passé) : pose tutorialSeenAt une seule
  // fois. Tant que c'est nul, le front le lance automatiquement après
  // l'onboarding ; une fois posé, il ne se déclenche plus qu'à la demande.
  @UseGuards(JwtAuthGuard)
  @Post('me/tutorial-seen')
  async markTutorialSeen(@CurrentUser() current: JwtPayload) {
    const user = await this.usersService.findById(current.sub);
    if (!user) throw new NotFoundException();
    const updated = user.tutorialSeenAt
      ? user
      : await this.usersService.update(current.sub, { tutorialSeenAt: new Date() });
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

  // RGPD — export self-service de toutes ses données personnelles (droit d'accès
  // Art. 15 + portabilité Art. 20), en JSON structuré téléchargeable. Deux
  // segments ⇒ pas de conflit avec @Get(':id').
  @UseGuards(JwtAuthGuard)
  @Get('me/export')
  async exportMyData(@CurrentUser() current: JwtPayload, @Res({ passthrough: true }) res: Response) {
    const data = await this.usersService.exportData(current.sub);
    if (!data) throw new NotFoundException();
    const date = new Date().toISOString().slice(0, 10);
    const safeName = data.account.username.replace(/[^a-zA-Z0-9_-]/g, '_');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="saveboxd-data-${safeName}-${date}.json"`);
    // RGPD — email de confirmation de l'opération sur les données (mailer.send
    // avale ses erreurs → n'échoue jamais le téléchargement si le SMTP est down).
    await this.mailer.send({
      to: data.account.email,
      subject: 'Your Saveboxd data export',
      html: `<p>A copy of all your personal data was just downloaded from your Saveboxd settings.</p><p>If this wasn't you, change your password and enable two-factor authentication right away.</p>`,
    });
    return data;
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

    // On capture l'e-mail AVANT la suppression (la ligne user disparaît ensuite).
    const email = user.email;
    if (user.avatarUrl) await this.usersService.deleteAvatarFile(user.avatarUrl);
    await this.usersService.delete(current.sub);
    // RGPD — email de confirmation de suppression (best-effort ; le compte est
    // déjà supprimé, l'échec SMTP ne doit pas casser la réponse 204).
    await this.mailer.send({
      to: email,
      subject: 'Your Saveboxd account has been deleted',
      html: `<p>Your Saveboxd account and personal data have been permanently deleted, as you requested.</p><p>Your reviews and comments are kept but anonymized (shown as from a deleted user). If you did not request this, contact us immediately.</p>`,
    });
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
