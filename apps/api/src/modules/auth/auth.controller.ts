import { Controller, Post, Get, Body, Res, UseGuards, Req } from "@nestjs/common";
import { Response, Request } from "express";
import { AuthService } from "./auth.service";
import { SessionService } from "./session.service";
import { AuthGuard } from "./auth.guard";
import { RegisterDto } from "./dto/register.dto";
import { LoginDto } from "./dto/login.dto";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { COOKIE_NAME, SESSION_TTL_MS, extractToken } from "./auth.constants";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly session: SessionService,
  ) {}

  @Post("register")
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const { token, user } = await this.auth.register(dto.email, dto.password, dto.language);
    this.setCookie(res, token);
    return { user };
  }

  @Post("login")
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const { token, user } = await this.auth.login(dto.email, dto.password);
    this.setCookie(res, token);
    return { user };
  }

  @Post("change-password")
  @UseGuards(AuthGuard)
  async changePassword(
    @Req() req: Request & { userId: string },
    @Body() dto: ChangePasswordDto,
  ) {
    return this.auth.updatePassword(req.userId, dto.currentPassword, dto.newPassword);
  }

  @Post("logout")
  @UseGuards(AuthGuard)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = extractToken(req.headers?.cookie);
    if (token) await this.session.destroy(token);
    res.clearCookie(COOKIE_NAME);
    return { success: true };
  }

  @Get("me")
  @UseGuards(AuthGuard)
  async me(@Req() req: Request & { userId: string }) {
    return this.auth.me(req.userId);
  }

  private setCookie(res: Response, token: string) {
    const isDev = process.env.NODE_ENV !== "production";
    const secureCookie = process.env.COOKIE_SECURE === undefined
      ? !isDev
      : process.env.COOKIE_SECURE === "true";
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure: secureCookie,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_TTL_MS,
    });
  }
}
