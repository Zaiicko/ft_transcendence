import { Module } from '@nestjs/common';
import { ListsModule } from '../lists/lists.module';
import { MailerModule } from '../mailer/mailer.module';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

@Module({
  imports: [ListsModule, MailerModule], // public lists on the profile + RGPD confirmation emails
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService], // so AuthModule can inject it later
})
export class UsersModule {}
