import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FeedModule } from '../feed/feed.module';
import { UsersModule } from '../users/users.module';
import { PsnApiService } from './psn-api.service';
import { PsnController } from './psn.controller';

// Fonctionnalités liées au compte PlayStation via la lib psn-api. Modèle à
// session service unique (PSN_SERVICE_NPSSO) : les utilisateurs déclarent leur
// PSN Online ID public, le backend le résout et lira leurs jeux/trophées/amis
// publics. Aucun jeton par utilisateur.
@Module({
  imports: [AuthModule, UsersModule, FeedModule],
  controllers: [PsnController],
  providers: [PsnApiService],
  exports: [PsnApiService],
})
export class PsnModule {}
