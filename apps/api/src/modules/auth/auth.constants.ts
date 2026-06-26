export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
export const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000;
export const COOKIE_NAME = "gridpilot_session";

export function extractToken(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : undefined;
}
