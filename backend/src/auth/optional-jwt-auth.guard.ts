import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// Same JWT-cookie strategy as JwtAuthGuard, but never rejects: public routes
// get `request.user` when a valid token is present, undefined otherwise.
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser>(_err: unknown, user: TUser | false): TUser | undefined {
    return user || undefined;
  }
}
