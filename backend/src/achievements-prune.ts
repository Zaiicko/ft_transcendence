// Standalone integrity pass — run with `npm run achievements:prune`.
// Re-checks every user's 'perfect'/'completions'/'genres'/'linked' badges
// against their current data and drops any tier that no longer holds. Needed
// for accounts that unlinked a platform (Steam/Xbox/PSN) before revoke() was
// added to the unlink flow, since that cleanup only ran going forward.
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AchievementsService } from './achievements/achievements.service';
import { PrismaService } from './prisma/prisma.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  const prisma = app.get(PrismaService);
  const achievements = app.get(AchievementsService);

  const users = await prisma.user.findMany({ select: { id: true, username: true } });
  let checked = 0;
  for (const u of users) {
    const before = await prisma.userAchievement.count({ where: { userId: u.id } });
    await achievements.revoke(u.id, ['perfect', 'completions', 'genres', 'linked']);
    const after = await prisma.userAchievement.count({ where: { userId: u.id } });
    if (after < before) console.log(`${u.username}: ${before - after} stale badge(s) removed`);
    checked++;
  }

  console.log(`Done — ${checked} user(s) checked.`);
  await app.close();
}

main().catch((err) => {
  console.error('Achievements prune failed:', err.message ?? err);
  process.exit(1);
});
