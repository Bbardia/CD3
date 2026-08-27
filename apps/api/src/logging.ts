const LEVEL_LABELS: Record<number, string> = {
  10: 'TRACE',
  20: 'DEBUG',
  30: 'INFO',
  40: 'WARN',
  50: 'ERROR',
  60: 'FATAL',
};

/**
 * One readable line per event instead of pino's JSON: local time, level, message, and the stack
 * when an error is attached. A line that is not pino JSON passes through untouched.
 */
export function formatLogLine(line: string): string {
  try {
    const entry = JSON.parse(line) as {
      level?: number;
      time?: number;
      msg?: string;
      err?: { stack?: string; message?: string };
    };
    if (typeof entry.level !== 'number') {
      return line;
    }
    const time = new Date(entry.time ?? Date.now()).toTimeString().slice(0, 8);
    const label = LEVEL_LABELS[entry.level] ?? String(entry.level);
    const error = entry.err?.stack ?? entry.err?.message;
    const message = entry.msg ?? error ?? '';
    return `${time} ${label} ${message}${error !== undefined && message !== error ? `\n${error}` : ''}\n`;
  } catch {
    return line;
  }
}

interface QuietLoggerOptions {
  readonly level: string;
  readonly base: null;
  readonly stream: { write: (line: string) => void };
}

/** Quiet, readable logging: silent routine traffic, `LOG_LEVEL` to dig deeper. */
export function loggerOptions(): QuietLoggerOptions | false {
  if (process.env.NODE_ENV === 'test') {
    return false;
  }
  return {
    level: process.env.LOG_LEVEL ?? 'info',
    base: null,
    stream: {
      write(line: string) {
        process.stdout.write(formatLogLine(line));
      },
    },
  };
}
