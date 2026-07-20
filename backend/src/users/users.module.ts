import { Module } from '@nestjs/common';
import { ListsModule } from '../lists/lists.module';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

@Module({
  imports: [ListsModule], // for public lists on the profile
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService], // so AuthModule can inject it later
})
export class UsersModule {}
