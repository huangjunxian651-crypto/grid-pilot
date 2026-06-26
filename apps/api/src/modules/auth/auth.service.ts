import { Injectable, ForbiddenException, UnauthorizedException } from "@nestjs/common";
import * as bcrypt from "bcrypt";
import { PrismaService } from "../../prisma/prisma.service";
import { SessionService } from "./session.service";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly session: SessionService,
  ) {}

  async register(email: string, password: string, language: string = "zh") {
    return this.prisma.$transaction(async (tx) => {
      // Serialize registrations with PostgreSQL advisory lock to prevent
      // race conditions under READ COMMITTED isolation.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(1)`;

      const existing = await tx.user.findFirst();
      if (existing && existing.passwordHash) {
        throw new ForbiddenException("User already exists");
      }

      const passwordHash = await bcrypt.hash(password, 10);

      if (existing) {
        const user = await tx.user.update({
          where: { id: existing.id },
          data: { email, passwordHash, language },
        });
        const token = await this.session.create(user.id);
        return {
          token,
          user: { id: user.id, email: user.email, displayName: user.displayName, language: user.language },
        };
      }

      const user = await tx.user.create({
        data: { email, passwordHash, displayName: "", language },
      });
      const token = await this.session.create(user.id);
      return {
        token,
        user: { id: user.id, email: user.email, displayName: user.displayName, language: user.language },
      };
    });
  }

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new UnauthorizedException("Invalid credentials");
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException("Invalid credentials");
    }

    const token = await this.session.create(user.id);
    return {
      token,
      user: { id: user.id, email: user.email, displayName: user.displayName, language: user.language },
    };
  }

  async logout(token: string) {
    await this.session.destroy(token);
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return null;
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      language: user.language,
    };
  }

  async updatePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException("User not found");
    }

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException("Current password is incorrect");
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newPasswordHash },
    });

    return { success: true };
  }
}
