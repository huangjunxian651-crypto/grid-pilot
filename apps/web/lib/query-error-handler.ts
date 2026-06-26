import { ApiError } from "./api";
import { toast } from "sonner";
import { translate, isValidLang, type Lang } from "./i18n";

function currentLang(): Lang {
  if (typeof localStorage !== "undefined") {
    const v = localStorage.getItem("gp.lang");
    if (v && isValidLang(v)) return v;
  }
  return "zh";
}

const SERVER_ERROR_CODES = new Set([500, 502, 503, 504]);

function showToastForError(error: unknown): void {
  if (!(error instanceof ApiError)) return;
  if (error.status === 401) return;
  if (SERVER_ERROR_CODES.has(error.status)) {
    toast.error("服务异常，请稍后重试");
    return;
  }
  if (error.code) {
    const key = `errors.${error.code}`;
    const localized = translate(key, currentLang());
    if (localized !== key) { toast.error(localized); return; }
  }
  toast.error(error.message);
}

function redirectIf401(error: unknown): boolean {
  if (
    typeof window !== "undefined" &&
    error instanceof ApiError &&
    error.status === 401
  ) {
    window.location.href = "/login";
    return true;
  }
  return false;
}

export function handleQueryError(
  error: unknown,
  query: { meta?: Record<string, unknown> | undefined },
): void {
  if (
    error instanceof ApiError &&
    error.status === 401 &&
    query.meta?.skipAuthRedirect
  ) return;
  if (redirectIf401(error)) return;
  showToastForError(error);
}

export function handleMutationError(
  error: unknown,
  _mutation: unknown,
  _context: unknown,
): void {
  if (redirectIf401(error)) return;
  showToastForError(error);
}
