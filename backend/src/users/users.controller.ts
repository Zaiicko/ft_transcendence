import { Controller, Get, NotFoundException, Param, ParseIntPipe } from '@nestjs/common';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // Public profile only — never return passwordHash / twoFactorSecret
  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const user = await this.usersService.findById(id);
    if (!user) throw new NotFoundException();

    const { passwordHash, twoFactorSecret, ...publicProfile } = user;
    return publicProfile;
  }
}
