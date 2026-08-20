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
  Query,
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
import { AdminGuard } from '../auth/admin.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { hashPassword, verifyPassword } from '../auth/password.util';
import { AVATARS_DIR } from '../common/uploads';
import { MailerService } from '../mailer/mailer.service';
import { BanUserDto } from './dto/ban-user.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { SetPasswordDto } from './dto/set-password.dto';
import { AvatarFrameDto } from './dto/avatar-frame.dto';
import { LibraryVisibilityDto } from './dto/library-visibility.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { toPublicUser, toPublicUserLite } from './public-user';
import { UsersService } from './users.service';

// image/gif included: avatars are stored as-is (no re-encoding), so an animated
// GIF stays animated in the <img>. 4MB stays under nginx's client_max_body_size
// of 5m and is plenty for an avatar.
//
// Doubles as the extension whitelist, so the stored filename never derives from
// file.originalname: a client can send Content-Type: image/png while naming the
// file "x.html", and we'd serve attacker-controlled HTML from our own origin
// under /api/uploads — stored XSS, since the CSP's script-src 'self' trusts it.
const AVATAR_EXT_BY_MIME = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
]);
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

  // "Your year in games" stats band on the signed-in home. Two path segments,
  // so it can't collide with @Get(':id'). Owner only.
  @UseGuards(JwtAuthGuard)
  @Get('me/home-stats')
  homeStats(@CurrentUser() current: JwtPayload) {
    return this.usersService.getHomeStats(current.sub);
  }

  // Player search by username for the main search bar. Declared before ':id'
  // so "search" isn't parsed as an id.
  @Get('search')
  search(@Query('q') q?: string) {
    return this.usersService.search(q?.trim() ?? '');
  }

  // Public lookup by id: MINIMAL view (identity + badges). Never another user's
  // email, settings, tokens or secrets.
  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const user = await this.usersService.findById(id);
    if (!user) throw new NotFoundException();
    return toPublicUserLite(user);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Patch(':id/ban')
  @HttpCode(204)
  async ban(
    @CurrentUser() admin: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: BanUserDto,
  ) {
    await this.usersService.ban(admin.sub, id, dto.reason);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Delete(':id/ban')
  @HttpCode(204)
  async unban(@Param('id', ParseIntPipe) id: number) {
    await this.usersService.unban(id);
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

  // Toggles whether other users can see this account's linked libraries (the
  // "View library" button on the public profile). Never affects the owner's
  // own view or the background completion sync — see PsnController /
  // XboxController / SteamController `publicLibrary`.
  @UseGuards(JwtAuthGuard)
  @Patch('me/library-visibility')
  async setLibraryVisibility(@CurrentUser() current: JwtPayload, @Body() dto: LibraryVisibilityDto) {
    const updated = await this.usersService.update(current.sub, { libraryPublic: dto.public });
    return toPublicUser(updated);
  }

  // Marks the onboarding wizard done (or explicitly skipped): sets onboardedAt
  // once. While null the front redirects to /welcome; once set there is no auto
  // redirect and the user goes through settings instead.
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

  // Marks the guided tour seen (or skipped): sets tutorialSeenAt once. While
  // null the front starts it automatically after onboarding; once set it only
  // runs on demand.
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

  // GDPR self-service export of every personal record (right of access Art. 15
  // and portability Art. 20) as downloadable JSON. Two path segments, so it
  // can't collide with @Get(':id').
  @UseGuards(JwtAuthGuard)
  @Get('me/export')
  async exportMyData(@CurrentUser() current: JwtPayload, @Res({ passthrough: true }) res: Response) {
    const data = await this.usersService.exportData(current.sub);
    if (!data) throw new NotFoundException();
    const date = new Date().toISOString().slice(0, 10);
    const safeName = data.account.username.replace(/[^a-zA-Z0-9_-]/g, '_');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="saveboxd-data-${safeName}-${date}.json"`);
    // GDPR confirmation email. mailer.send swallows its errors, so a dead SMTP
    // relay never fails the download.
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

    // Capture the address BEFORE deleting — the user row is gone afterwards.
    const email = user.email;
    if (user.avatarUrl) await this.usersService.deleteAvatarFile(user.avatarUrl);
    await this.usersService.delete(current.sub);
    // GDPR deletion confirmation, best-effort: the account is already gone, so
    // an SMTP failure must not break the 204.
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
        // fileFilter runs first, so the mime type is always one of the four.
        filename: (_req, file, cb) =>
          cb(null, `${randomUUID()}${AVATAR_EXT_BY_MIME.get(file.mimetype) ?? ''}`),
      }),
      fileFilter: (_req, file, cb) => cb(null, AVATAR_EXT_BY_MIME.has(file.mimetype)),
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

  // Avatar zoom/centering, encoded in avatarUrl as #af=scale,x,y. Browsers strip
  // the fragment when fetching the image, but it travels with avatarUrl in every
  // response, so the framing applies everywhere without extra fields. The
  // default (1,0,0) writes no fragment at all.
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
