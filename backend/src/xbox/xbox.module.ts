import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FeedModule } from '../feed/feed.module';
import { UsersModule } from '../users/users.module';
import { XboxApiService } from './xbox-api.service';
import { XboxController } from './xbox.controller';

// Fonctionnalités liées au compte Xbox via OpenXBL (xbl.io). Modèle à clé
// service unique (XBL_API_KEY) : les utilisateurs déclarent leur gamertag
// public, le backend le résout et lit leurs jeux/succès publics. Aucun jeton par
// utilisateur. Miroir de PsnModule.
@Module({
  imports: [AuthModule, UsersModule, FeedModule],
  controllers: [XboxController],
  providers: [XboxApiService],
  exports: [XboxApiService],
})
export class XboxModule {}
