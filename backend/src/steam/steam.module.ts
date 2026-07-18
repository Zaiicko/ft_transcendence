import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { SteamAuthController } from './steam-auth.controller';
import { SteamController } from './steam.controller';
import { SteamOpenidService } from './steam-openid.service';
import { SteamWebApiService } from './steam-web-api.service';

// Steam account features: OpenID sign-in/link/register, library import and
// friend suggestions. Kept separate from AuthModule (mate's turf) and from
// games/steam (catalog score sync) on purpose.
@Module({
  imports: [AuthModule, UsersModule],
  controllers: [SteamAuthController, SteamController],
  providers: [SteamOpenidService, SteamWebApiService],
})
export class SteamModule {}
