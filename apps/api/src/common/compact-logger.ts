import { LoggerService, LogLevel } from '@nestjs/common';

export class CompactLogger implements LoggerService {
  private static levels: LogLevel[] = ['log', 'error', 'warn', 'debug', 'verbose'];

  constructor(levels?: LogLevel[]) {
    if (levels) CompactLogger.levels = levels;
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.print('ERR', message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.print('WRN', message, optionalParams);
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.print('INF', message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.print('DBG', message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.print('VRB', message, optionalParams);
  }

  isLevelEnabled(level: LogLevel): boolean {
    return CompactLogger.levels.includes(level);
  }

  private print(level: string, message: unknown, params: unknown[]): void {
    const now = new Date();
    const ts = `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    const context = this.extractContext(params);
    const ctx = context ? ` [${context}]` : '';
    const color = this.colorForLevel(level);
    const reset = '\x1b[0m';
    const out = `${color}${ts} ${level}${reset}${ctx} ${message}`;
    if (level === 'ERR') {
      process.stderr.write(out + '\n');
    } else {
      process.stdout.write(out + '\n');
    }
  }

  private extractContext(params: unknown[]): string | undefined {
    if (params.length === 0) return undefined;
    const last = params[params.length - 1];
    if (typeof last === 'string' && last.length > 0 && !last.includes(' ')) return last;
    return undefined;
  }

  private colorForLevel(level: string): string {
    switch (level) {
      case 'ERR': return '\x1b[31m';
      case 'WRN': return '\x1b[33m';
      case 'INF': return '\x1b[32m';
      case 'DBG': return '\x1b[36m';
      default: return '\x1b[90m';
    }
  }
}
