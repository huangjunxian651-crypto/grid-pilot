import { Injectable, Optional } from "@nestjs/common";
import Redis from "ioredis";
import { randomBytes } from "crypto";
import { SESSION_TTL_SECONDS } from "./auth.constants";

@Injectable()
export class SessionService {
  private readonly redis: Redis;

  constructor(@Optional() redis?: Redis) {
    this.redis = redis ?? new Redis(process.env.REDIS_URL || "redis://localhost:26379");
  }

  async create(userId: string): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    await this.redis.setex(
      `session:${token}`,
      SESSION_TTL_SECONDS,
      JSON.stringify({ userId }),
    );
    return token;
  }

  async validate(token: string): Promise<string | null> {
    const data = await this.redis.get(`session:${token}`);
    if (!data) return null;
    return JSON.parse(data).userId;
  }

  async destroy(token: string): Promise<void> {
    await this.redis.del(`session:${token}`);
  }
}
