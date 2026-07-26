import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { existsSync } from 'fs';
import { unlink } from 'fs/promises';
import { basename, join } from 'path';
import { LIST_COVERS_DIR } from '../common/uploads';
import { PrismaService } from '../prisma/prisma.service';
import { AddItemDto } from './dto/add-item.dto';
import { CreateListDto } from './dto/create-list.dto';
import { UpdateListDto } from './dto/update-list.dto';

// Jeux inclus dans l'aperçu d'une liste (jaquettes empilées sur la carte)
const PREVIEW_COVERS = 5;
// Nombre maximum de listes par utilisateur
const MAX_LISTS = 6;
// Nombre maximum de jeux par liste
const MAX_GAMES_PER_LIST = 30;

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
    // Avis du PROPRIÉTAIRE de la liste sur ces jeux (note + extrait affichés à
    // côté de chaque jeu, façon Letterboxd).
    const gameIds = list.items.map((it) => it.game.id);
    const reviews = gameIds.length
      ? await this.prisma.review.findMany({
          where: { userId: list.userId, gameId: { in: gameIds } },
          select: { id: true, gameId: true, rating: true, title: true, text: true },
        })
      : [];
    const reviewByGame = new Map(reviews.map((r) => [r.gameId, r]));
    return {
      id: list.id,
      name: list.name,
      isPublic: list.isPublic,
      coverUrl: list.coverUrl,
      owner: list.user,
      games: list.items.map((it) => {
        const r = reviewByGame.get(it.game.id);
        return {
          ...it.game,
          review: r ? { id: r.id, rating: r.rating, title: r.title, text: r.text } : null,
        };
      }),
    };
  }

  async create(userId: number, dto: CreateListDto) {
    const count = await this.prisma.gameList.count({ where: { userId } });
    if (count >= MAX_LISTS) {
      throw new ConflictException(`Limite de ${MAX_LISTS} listes atteinte.`);
    }
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
    const list = await this.prisma.gameList.findUnique({
      where: { id },
      select: { coverUrl: true },
    });
    await this.prisma.gameList.delete({ where: { id } });
    if (list?.coverUrl) await this.deleteCoverFile(list.coverUrl);
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
    // Limite atteinte seulement pour un NOUVEAU jeu (re-ajouter un jeu déjà
    // présent est idempotent et ne doit pas être bloqué).
    const already = await this.prisma.gameListItem.findUnique({
      where: { listId_gameId: { listId, gameId: dto.gameId } },
      select: { id: true },
    });
    if (!already) {
      const count = await this.prisma.gameListItem.count({ where: { listId } });
      if (count >= MAX_GAMES_PER_LIST) {
        throw new ConflictException(`Limite de ${MAX_GAMES_PER_LIST} jeux par liste atteinte.`);
      }
    }
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

  // Réordonne : la position de chaque jeu devient son index dans `gameIds`.
  // updateMany filtre par listId → ne touche que les items de CETTE liste.
  async reorder(userId: number, listId: number, gameIds: number[]) {
    await this.assertOwner(userId, listId);
    await this.prisma.$transaction(
      gameIds.map((gameId, index) =>
        this.prisma.gameListItem.updateMany({
          where: { listId, gameId },
          data: { position: index },
        }),
      ),
    );
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
    coverUrl: string | null;
    _count: { items: number };
    items: { game: { coverUrl: string | null } }[];
  }) {
    return {
      id: list.id,
      name: list.name,
      isPublic: list.isPublic,
      coverUrl: list.coverUrl,
      gameCount: list._count.items,
      covers: list.items.map((it) => it.game.coverUrl).filter((c): c is string => !!c),
    };
  }

  // --- Image de couverture de liste (upload, tous formats dont GIF) ---

  async setCover(userId: number, listId: number, url: string) {
    await this.assertOwner(userId, listId);
    const prev = await this.prisma.gameList.findUnique({
      where: { id: listId },
      select: { coverUrl: true },
    });
    const list = await this.prisma.gameList.update({
      where: { id: listId },
      data: { coverUrl: url },
      include: this.summaryInclude(),
    });
    if (prev?.coverUrl) await this.deleteCoverFile(prev.coverUrl);
    return this.toSummary(list);
  }

  // Cadrage (zoom/centrage) encodé dans coverUrl via #af=scale,x,y. On repart
  // toujours de la base (fragment retiré) ; défaut (1,0,0) → URL propre.
  async setCoverFrame(
    userId: number,
    listId: number,
    frame: { scale: number; x: number; y: number },
  ) {
    await this.assertOwner(userId, listId);
    const current = await this.prisma.gameList.findUnique({
      where: { id: listId },
      select: { coverUrl: true },
    });
    if (!current?.coverUrl) throw new NotFoundException('No cover to frame');
    const base = current.coverUrl.split('#')[0];
    const framed =
      frame.scale === 1 && frame.x === 0 && frame.y === 0
        ? base
        : `${base}#af=${frame.scale},${frame.x},${frame.y}`;
    const list = await this.prisma.gameList.update({
      where: { id: listId },
      data: { coverUrl: framed },
      include: this.summaryInclude(),
    });
    return this.toSummary(list);
  }

  async removeCover(userId: number, listId: number) {
    await this.assertOwner(userId, listId);
    const prev = await this.prisma.gameList.findUnique({
      where: { id: listId },
      select: { coverUrl: true },
    });
    const list = await this.prisma.gameList.update({
      where: { id: listId },
      data: { coverUrl: null },
      include: this.summaryInclude(),
    });
    if (prev?.coverUrl) await this.deleteCoverFile(prev.coverUrl);
    return this.toSummary(list);
  }

  // coverUrl = /api/uploads/list-covers/<file> — ne supprime que dans le dossier
  // dédié. split('#') : ignore un éventuel fragment.
  async deleteCoverFile(coverUrl: string): Promise<void> {
    const filePath = join(LIST_COVERS_DIR, basename(coverUrl.split('#')[0]));
    if (filePath.startsWith(LIST_COVERS_DIR) && existsSync(filePath)) {
      await unlink(filePath);
    }
  }

  // @@unique([userId, name]) violé → 409 avec un message clair
  private rethrowDuplicateName(e: unknown) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return new ConflictException('Tu as déjà une liste avec ce nom.');
    }
    return e;
  }
}
