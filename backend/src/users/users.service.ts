import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { existsSync } from 'fs';
import { unlink } from 'fs/promises';
import { basename, join } from 'path';
import { AVATARS_DIR } from '../common/uploads';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  // Used by AuthModule (local signup + OAuth provisioning)
  create(data: Prisma.UserCreateInput) {
    return this.prisma.user.create({ data });
  }

  findById(id: number) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findByUsername(username: string) {
    return this.prisma.user.findUnique({ where: { username } });
  }

  update(id: number, data: Prisma.UserUpdateInput) {
    return this.prisma.user.update({ where: { id }, data });
  }

  delete(id: number) {
    return this.prisma.user.delete({ where: { id } });
  }

  // avatarUrl looks like /api/uploads/avatars/<file> — only ever deletes inside AVATARS_DIR
  async deleteAvatarFile(avatarUrl: string): Promise<void> {
    const filePath = join(AVATARS_DIR, basename(avatarUrl));
    if (filePath.startsWith(AVATARS_DIR) && existsSync(filePath)) {
      await unlink(filePath);
    }
  }
}
