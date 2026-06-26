import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { SessionService } from "./session.service";
import { extractToken } from "./auth.constants";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly session: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = this.extractToken(request);
    if (!token) throw new UnauthorizedException();

    const userId = await this.session.validate(token);
    if (!userId) throw new UnauthorizedException();

    request.userId = userId;
    return true;
  }

  private extractToken(request: any): string | undefined {
    const cookie = request.headers?.cookie;
    if (cookie) {
      const match = cookie.match(/gridpilot_session=([^;]+)/);
      if (match) return decodeURIComponent(match[1]);
    }
    const auth = request.headers?.authorization;
    if (auth?.startsWith("Bearer ")) {
      return auth.slice(7);
    }
    return undefined;
  }
}
