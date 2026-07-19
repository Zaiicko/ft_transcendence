import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy as OAuth2Strategy, StrategyOptions, VerifyCallback } from 'passport-oauth2';
import { OAuthProfile } from './google.strategy';

interface FortyTwoMe {
  id: number;
  email: string;
  login: string;
  // 42 intra profile picture (`image.link` is the full-size version)
  image?: { link?: string };
}

// passport-oauth2 has no built-in profile fetch — override userProfile to
// hit the 42 intra API with the access token it just obtained.
class FortyTwoOAuth2Strategy extends OAuth2Strategy {
  userProfile(accessToken: string, done: (err?: Error | null, profile?: FortyTwoMe) => void): void {
    fetch('https://api.intra.42.fr/v2/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error(`42 intra profile fetch failed: ${res.status}`);
        return res.json();
      })
      .then((data: FortyTwoMe) => done(undefined, data))
      .catch((err: unknown) =>
        done(err instanceof Error ? err : new Error(String(err))),
      );
  }
}

// passport-oauth2 throws at construction time if clientID/clientSecret are empty,
// which would otherwise take down the whole backend when OAuth apps haven't been
// registered yet. Fall back to a placeholder so the app still boots — the /auth/42
// route just fails cleanly upstream instead of crashing on startup.
const UNCONFIGURED = 'not-configured';

@Injectable()
export class FortyTwoStrategy extends PassportStrategy(FortyTwoOAuth2Strategy, 'fortytwo') {
  constructor(config: ConfigService) {
    const options: StrategyOptions = {
      authorizationURL: 'https://api.intra.42.fr/oauth/authorize',
      tokenURL: 'https://api.intra.42.fr/oauth/token',
      clientID: config.get<string>('FORTYTWO_CLIENT_ID') || UNCONFIGURED,
      clientSecret: config.get<string>('FORTYTWO_CLIENT_SECRET') || UNCONFIGURED,
      callbackURL: config.get<string>('FORTYTWO_CALLBACK_URL') || undefined,
    };
    super(options);
  }

  validate(_accessToken: string, _refreshToken: string, profile: FortyTwoMe, done: VerifyCallback): void {
    const oauthProfile: OAuthProfile = {
      providerId: String(profile.id),
      email: profile.email,
      displayName: profile.login,
      avatarUrl: profile.image?.link,
    };
    done(null, oauthProfile);
  }
}
