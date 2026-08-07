export function hasActiveLiveRobots(robots: Array<{ environment: string; endedAt: string | null }>): boolean {
  return robots.some((r) => r.environment === "live" && r.endedAt == null);
}
