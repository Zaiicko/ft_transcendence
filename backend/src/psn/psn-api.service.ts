import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  exchangeAccessCodeForAuthTokens,
  exchangeNpssoForAccessCode,
  makeUniversalSearch,
  type AuthorizationPayload,
} from 'psn-api';

export interface PsnAccount {
  accountId: string;
  onlineId: string;
  avatarUrl: string | null;
}

// PSN n'a pas d'API publique et pas d'OAuth ouvert. Modèle "infinitebacklog" :
// le backend détient UNE session PSN (un jeton NPSSO service, PSN_SERVICE_NPSSO)
// et s'en sert pour lire les profils PUBLICS que les utilisateurs déclarent par
// leur PSN Online ID. Aucun jeton par utilisateur.
@Injectable()
export class PsnApiService {
  private readonly logger = new Logger(PsnApiService.name);

  // Autorisation service en cache + échéance (le jeton d'accès dure ~1 h). On
  // ré-échange simplement le NPSSO quand il expire (NPSSO valide ~2 mois).
  private auth: AuthorizationPayload | null = null;
  private authExpiresAt = 0;

  constructor(private readonly config: ConfigService) {}

  private npsso(): string {
    const npsso = this.config.get<string>('PSN_SERVICE_NPSSO');
    if (!npsso) {
      throw new ServiceUnavailableException(
        'PlayStation non configuré — PSN_SERVICE_NPSSO manquant dans .env',
      );
    }
    return npsso;
  }

  // Renvoie une autorisation service valide (depuis le cache ou en ré-échangeant
  // le NPSSO). NPSSO expiré => 503 (invite à en régénérer un côté serveur).
  private async serviceAuth(): Promise<AuthorizationPayload> {
    if (this.auth && Date.now() < this.authExpiresAt) return this.auth;
    // Hors du try : "non configuré" (503) doit remonter avec son message propre,
    // sans être masqué par le catch générique ci-dessous.
    const npsso = this.npsso();
    try {
      const accessCode = await exchangeNpssoForAccessCode(npsso);
      const auth = await exchangeAccessCodeForAuthTokens(accessCode);
      this.auth = auth;
      // marge de 60 s pour ne pas utiliser un jeton au bord de l'expiration
      this.authExpiresAt = Date.now() + Math.max(0, (auth.expiresIn - 60) * 1000);
      return auth;
    } catch (e) {
      this.auth = null;
      this.authExpiresAt = 0;
      this.logger.error(`Session PSN service indisponible: ${e instanceof Error ? e.message : e}`);
      throw new ServiceUnavailableException(
        'Session PlayStation service indisponible — le jeton NPSSO service est peut-être expiré',
      );
    }
  }

  // Résout un PSN Online ID (pseudo public) en compte { accountId, onlineId,
  // avatar }. Renvoie null si aucun compte ne correspond exactement.
  async resolveOnlineId(onlineId: string): Promise<PsnAccount | null> {
    const auth = await this.serviceAuth();
    let res;
    try {
      res = await makeUniversalSearch(auth, onlineId, 'SocialAllAccounts');
    } catch (e) {
      this.logger.warn(`Recherche PSN échouée: ${e instanceof Error ? e.message : e}`);
      throw new ServiceUnavailableException('Recherche PlayStation indisponible');
    }

    const wanted = onlineId.trim().toLowerCase();
    for (const domain of res.domainResponses ?? []) {
      for (const result of domain.results ?? []) {
        const meta = result.socialMetadata;
        if (meta?.onlineId?.toLowerCase() === wanted && meta.accountId) {
          return {
            accountId: meta.accountId,
            onlineId: meta.onlineId,
            avatarUrl: meta.avatarUrl || null,
          };
        }
      }
    }
    return null;
  }
}
