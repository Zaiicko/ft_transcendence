import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy, VerifyCallback } from 'passport-google-oauth20';

export interface OAuthProfile {
  providerId: string;
  email: string;
  displayName: string;
}

// passport-google-oauth20 throws at construction time if clientID/clientSecret are
// empty, which would otherwise take down the whole backend when OAuth apps haven't
// been registered yet. Fall back to a placeholder so the app still boots — the
// /auth/google route just fails cleanly upstream instead of crashing on startup.
const UNCONFIGURED = 'not-configured';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(config: ConfigService) {
    super({
      clientID: config.get<string>('GOOGLE_CLIENT_ID') || UNCONFIGURED,
      clientSecret: config.get<string>('GOOGLE_CLIENT_SECRET') || UNCONFIGURED,
      callbackURL: config.get<string>('GOOGLE_CALLBACK_URL') || undefined,
      scope: ['profile', 'email'],
    });
  }

  validate(_accessToken: string, _refreshToken: string, profile: Profile, done: VerifyCallback): void {
    const oauthProfile: OAuthProfile = {
      providerId: profile.id,
      email: profile.emails?.[0]?.value ?? '',
      displayName: profile.displayName ?? '',
    };
    done(null, oauthProfile);
  }
}
