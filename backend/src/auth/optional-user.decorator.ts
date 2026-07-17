import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// Identity on PUBLIC routes: never rejects, just yields undefined when absent.
// TODO(auth): swap the header read for an optional JWT-cookie read alongside
// the real JwtAuthGuard — consumers keep working unchanged.
export const OptionalUser = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const id = Number(ctx.switchToHttp().getRequest().headers['x-debug-user-id']);
  return Number.isInteger(id) && id > 0 ? { id } : undefined;
});
