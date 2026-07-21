import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy as OAuth2Strategy, StrategyOptions, VerifyCallback } from 'passport-oauth2';
import { OAuthProfile } from './google.strategy';

interface DiscordMe {
  id: string;
  username: string;
  // Modern display name (may be null on older/unset accounts) — falls back
  // to the account username below.
  global_name: string | null;
  email: string | null;
  avatar: string | null;
}

// passport-oauth2 has no built-in profile fetch — override userProfile to
// hit Discord's own API with the access token it just obtained (same
// approach as the 42 intra strategy).
class DiscordOAuth2Strategy extends OAuth2Strategy {
  userProfile(accessToken: string, done: (err?: Error | null, profile?: DiscordMe) => void): void {
    fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Discord profile fetch failed: ${res.status}`);
        return res.json();
      })
      .then((data: DiscordMe) => done(undefined, data))
      .catch((err: unknown) => done(err instanceof Error ? err : new Error(String(err))));
  }
}

// passport-oauth2 throws at construction time if clientID/clientSecret are empty,
// which would otherwise take down the whole backend when OAuth apps haven't been
// registered yet. Fall back to a placeholder so the app still boots — the
// /auth/discord route just fails cleanly upstream instead of crashing on startup.
const UNCONFIGURED = 'not-configured';

@Injectable()
export class DiscordStrategy extends PassportStrategy(DiscordOAuth2Strategy, 'discord') {
  constructor(config: ConfigService) {
    const options: StrategyOptions = {
      authorizationURL: 'https://discord.com/api/oauth2/authorize',
      tokenURL: 'https://discord.com/api/oauth2/token',
      clientID: config.get<string>('DISCORD_CLIENT_ID') || UNCONFIGURED,
      clientSecret: config.get<string>('DISCORD_CLIENT_SECRET') || UNCONFIGURED,
      callbackURL: config.get<string>('DISCORD_CALLBACK_URL') || undefined,
      scope: ['identify', 'email'],
    };
    super(options);
  }

  validate(_accessToken: string, _refreshToken: string, profile: DiscordMe, done: VerifyCallback): void {
    const avatarUrl = profile.avatar
      ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.${profile.avatar.startsWith('a_') ? 'gif' : 'png'}`
      : undefined;
    const oauthProfile: OAuthProfile = {
      providerId: profile.id,
      // Discord's "email" OAuth scope can still come back null (e.g. an
      // unverified account) — findOrCreateOAuthUser needs a non-null string.
      email: profile.email ?? '',
      displayName: profile.global_name || profile.username,
      avatarUrl,
    };
    done(null, oauthProfile);
  }
}
