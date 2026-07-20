import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AddItemDto } from './dto/add-item.dto';
import { CreateListDto } from './dto/create-list.dto';
import { UpdateListDto } from './dto/update-list.dto';

// Jeux inclus dans l'aperçu d'une liste (jaquettes empilées sur la carte)
const PREVIEW_COVERS = 5;

@Injectable()
export class ListsService {
  constructor(private readonly prisma: PrismaService) {}

  // Toutes les listes de l'utilisateur (privées comprises) — pour son profil.
  // gameId optionnel : marque les listes contenant déjà ce jeu (menu "Ajouter").
  async listMine(userId: number, gameId?: number) {
    const [lists, containing] = await Promise.all([
      this.prisma.gameList.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        include: this.summaryInclude(),
      }),
      gameId
        ? this.prisma.gameListItem.findMany({
            where: { gameId, list: { userId } },
            select: { listId: true },
          })
        : Promise.resolve([]),
    ]);
    const has = new Set(containing.map((c) => c.listId));
    return lists.map((l) => ({
      ...this.toSummary(l),
      ...(gameId ? { contains: has.has(l.id) } : {}),
    }));
  }

  // Listes publiques d'un utilisateur donné — pour un profil consulté par autrui
  async publicListsOf(userId: number) {
    const lists = await this.prisma.gameList.findMany({
      where: { userId, isPublic: true },
      orderBy: { createdAt: 'desc' },
      include: this.summaryInclude(),
    });
    return lists.map((l) => this.toSummary(l));
  }

  // Détail d'une liste : publique pour tous, privée réservée au propriétaire
  async findOne(id: number, viewerId?: number) {
    const list = await this.prisma.gameList.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, username: true, avatarUrl: true } },
        items: {
          orderBy: { position: 'asc' },
          select: {
            game: {
              select: { id: true, title: true, coverUrl: true, releaseDate: true },
            },
          },
        },
      },
    });
    if (!list) throw new NotFoundException();
    if (!list.isPublic && list.userId !== viewerId) throw new ForbiddenException();
    return {
      id: list.id,
      name: list.name,
      isPublic: list.isPublic,
      owner: list.user,
      games: list.items.map((it) => it.game),
    };
  }

  async create(userId: number, dto: CreateListDto) {
    try {
      const list = await this.prisma.gameList.create({
        data: { userId, name: dto.name.trim(), isPublic: dto.isPublic ?? false },
        include: this.summaryInclude(),
      });
      return this.toSummary(list);
    } catch (e) {
      throw this.rethrowDuplicateName(e);
    }
  }

  async update(userId: number, id: number, dto: UpdateListDto) {
    await this.assertOwner(userId, id);
    try {
      const list = await this.prisma.gameList.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.isPublic !== undefined ? { isPublic: dto.isPublic } : {}),
        },
        include: this.summaryInclude(),
      });
      return this.toSummary(list);
    } catch (e) {
      throw this.rethrowDuplicateName(e);
    }
  }

  async remove(userId: number, id: number) {
    await this.assertOwner(userId, id);
    await this.prisma.gameList.delete({ where: { id } });
    return { ok: true };
  }

  // Ajoute un jeu en fin de liste ; ne bronche pas s'il y est déjà (idempotent)
  async addItem(userId: number, listId: number, dto: AddItemDto) {
    await this.assertOwner(userId, listId);
    const game = await this.prisma.game.findUnique({
      where: { id: dto.gameId },
      select: { id: true },
    });
    if (!game) throw new NotFoundException('Game not found');
    const last = await this.prisma.gameListItem.findFirst({
      where: { listId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    const position = (last?.position ?? -1) + 1;
    await this.prisma.gameListItem.upsert({
      where: { listId_gameId: { listId, gameId: dto.gameId } },
      update: {},
      create: { listId, gameId: dto.gameId, position },
    });
    return this.findOne(listId, userId);
  }

  async removeItem(userId: number, listId: number, gameId: number) {
    await this.assertOwner(userId, listId);
    await this.prisma.gameListItem.deleteMany({ where: { listId, gameId } });
    return this.findOne(listId, userId);
  }

  private async assertOwner(userId: number, listId: number) {
    const list = await this.prisma.gameList.findUnique({
      where: { id: listId },
      select: { userId: true },
    });
    if (!list) throw new NotFoundException();
    if (list.userId !== userId) throw new ForbiddenException();
  }

  private summaryInclude() {
    return {
      _count: { select: { items: true } },
      items: {
        orderBy: { position: 'asc' as const },
        take: PREVIEW_COVERS,
        select: { game: { select: { coverUrl: true } } },
      },
    };
  }

  private toSummary(list: {
    id: number;
    name: string;
    isPublic: boolean;
    _count: { items: number };
    items: { game: { coverUrl: string | null } }[];
  }) {
    return {
      id: list.id,
      name: list.name,
      isPublic: list.isPublic,
      gameCount: list._count.items,
      covers: list.items.map((it) => it.game.coverUrl).filter((c): c is string => !!c),
    };
  }

  // @@unique([userId, name]) violé → 409 avec un message clair
  private rethrowDuplicateName(e: unknown) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return new ConflictException('Tu as déjà une liste avec ce nom.');
    }
    return e;
  }
}
