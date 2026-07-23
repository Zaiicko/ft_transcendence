import {
  Body,
  ConflictException,
  Controller,
  Delete,
  HttpCode,
  NotFoundException,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { LinkPsnDto } from './dto/link-psn.dto';
import { PsnApiService } from './psn-api.service';

@UseGuards(JwtAuthGuard)
@Controller('psn')
export class PsnController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly api: PsnApiService,
  ) {}

  // Rattache un compte PlayStation : on résout le PSN Online ID déclaré en
  // accountId via la session service, puis on stocke l'ID + l'accountId (aucun
  // jeton par utilisateur). Le profil doit être public pour être trouvé.
  @Post('link')
  async link(@CurrentUser() current: JwtPayload, @Body() dto: LinkPsnDto) {
    const account = await this.api.resolveOnlineId(dto.onlineId.trim());
    if (!account) {
      throw new NotFoundException('Aucun compte PlayStation public trouvé pour cet Online ID');
    }

    // Un même compte PSN ne peut être rattaché qu'à un seul utilisateur
    const owner = await this.prisma.user.findUnique({
      where: { psnAccountId: account.accountId },
    });
    if (owner && owner.id !== current.sub) {
      throw new ConflictException('Ce compte PlayStation est déjà lié à un autre profil');
    }

    await this.prisma.user.update({
      where: { id: current.sub },
      data: { psnAccountId: account.accountId, psnOnlineId: account.onlineId },
    });

    return { onlineId: account.onlineId, avatarUrl: account.avatarUrl };
  }

  @Delete('link')
  @HttpCode(204)
  async unlink(@CurrentUser() current: JwtPayload) {
    const user = await this.users.findById(current.sub);
    if (!user) throw new UnauthorizedException();
    // PSN est un rattachement import-only (jamais un moyen de connexion), donc
    // pas de garde anti-lockout comme pour Steam/Discord.
    await this.prisma.user.update({
      where: { id: current.sub },
      data: { psnAccountId: null, psnOnlineId: null },
    });
  }
}
