import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const API_URL = process.env.API_URL ?? "http://localhost:3301";
const COOKIE_NAME = "gridpilot_session";

const PUBLIC_PATHS = ["/login"];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  if (pathname.startsWith("/_next")) return true;
  if (pathname.startsWith("/favicon")) return true;
  if (pathname.startsWith("/file.svg")) return true;
  if (pathname.startsWith("/globe.svg")) return true;
  if (pathname.startsWith("/next.svg")) return true;
  if (pathname.startsWith("/vercel.svg")) return true;
  if (pathname.startsWith("/window.svg")) return true;
  return false;
}

function redirectTologin(request: NextRequest, clearCookie = false) {
  const response = NextResponse.redirect(new URL("/login", request.url));
  if (clearCookie) {
    response.cookies.set(COOKIE_NAME, "", { maxAge: 0 });
  }
  return response;
}

async function verifySession(request: NextRequest): Promise<boolean> {
  const session = request.cookies.get(COOKIE_NAME);
  if (!session?.value) return false;

  try {
    const res = await fetch(`${API_URL}/api/auth/me`, {
      headers: { cookie: `${COOKIE_NAME}=${session.value}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    // Redirect authenticated users away from public pages (e.g. /login → /dashboard).
    // This mirrors the Next.js official auth middleware pattern.
    if (pathname === "/login" && (await verifySession(request))) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    return NextResponse.next();
  }

  // Protected route — verify session
  const session = request.cookies.get(COOKIE_NAME);
  if (!session?.value) {
    return redirectTologin(request);
  }

  try {
    const res = await fetch(`${API_URL}/api/auth/me`, {
      headers: { cookie: `${COOKIE_NAME}=${session.value}` },
    });

    // 仅当 API 明确回答「会话无效」（401）才清 cookie 跳登录。
    // 5xx 等服务异常时会话状态未知，放行——真正的鉴权由 API 侧 AuthGuard 兜底，
    // 误清 cookie 会把可恢复的登录态永久销毁（用户被迫重新登录）。
    if (res.status === 401) {
      return redirectTologin(request, true);
    }

    return NextResponse.next();
  } catch {
    // API 不可达（如开发环境重启窗口：Web 比 API 先就绪）≠ 未登录。
    // 放行并保留 cookie，待 API 恢复后登录态自动可用。
    return NextResponse.next();
  }
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
