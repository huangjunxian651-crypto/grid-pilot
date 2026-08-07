import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { AppModule } from "./app.module";
import { CompactLogger } from "./common/compact-logger";
import * as fs from "fs";
import * as path from "path";

function loadRootEnv(): void {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    const envPath = path.join(dir, ".env");
    if (fs.existsSync(envPath)) {
      require("dotenv").config({ path: envPath });
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // 容器化部署（docker compose up）不挂载 .env 文件，配置经 env_file/environment
  // 直接注入到 process.env。此时关键变量已存在即视为已配置，无需磁盘 .env 文件。
  if (process.env.DATABASE_URL && process.env.ENCRYPTION_KEY) {
    return;
  }
  throw new Error(
    "Root .env file not found and required env vars (DATABASE_URL / ENCRYPTION_KEY) are not set. " +
    "For local dev create it from .env.example: cp .env.example .env"
  );
}

loadRootEnv();

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: new CompactLogger(),
  });

  const webUrl = process.env.WEB_URL ?? "http://localhost:3300";
  // Allow the configured WEB_URL for CORS.
  // When WEB_URL uses localhost but the browser accesses via LAN IP,
  // the browser's origin will be http://<lan-ip>:<web-port>.
  // We derive allowed origins from WEB_URL and also support any IP origin
  // in development for convenience.
  const isDev = process.env.NODE_ENV !== "production";
  const origins: (string | RegExp)[] = [webUrl];
  if (isDev) {
    origins.push(/^http:\/\/\d+\.\d+\.\d+\.\d+:\d+$/);
  }
  app.enableCors({ origin: origins, credentials: true });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  app.setGlobalPrefix("api");

  const port = process.env.API_PORT ?? process.env.PORT ?? 3301;
  const host = process.env.API_HOST ?? "0.0.0.0";

  await app.listen(port, host);
  console.log(`GridPilot API listening on http://${host}:${port}`);
}

bootstrap();
