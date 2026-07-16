import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

// TODO(auth): replace the body of canActivate with real JWT verification
// (httpOnly cookie) once AuthModule exists. Every consumer keeps using
// @UseGuards(JwtAuthGuard) + @CurrentUser() unchanged — only this file moves.
@Injectable()
export class JwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const debugUserId = request.headers['x-debug-user-id'];
    if (!debugUserId) {
      throw new UnauthorizedException(
        'Missing x-debug-user-id header (temporary stub — no AuthModule yet)',
      );
    }
    request.user = { id: parseInt(debugUserId, 10) };
    return true;
  }
}
