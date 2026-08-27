import { describe, expect, it } from 'vitest';

import { formatLogLine } from '../src/logging.js';

describe('formatLogLine', () => {
  it('renders a pino line as time, level, and message', () => {
    const line = formatLogLine(
      `${JSON.stringify({ level: 30, time: 1787822288091, msg: 'Server listening at http://127.0.0.1:6985' })}\n`,
    );
    expect(line).toMatch(
      /^\d{2}:\d{2}:\d{2} INFO Server listening at http:\/\/127\.0\.0\.1:6985\n$/,
    );
  });

  it('carries an attached error stack onto its own lines', () => {
    const line = formatLogLine(
      JSON.stringify({
        level: 50,
        time: 1787822288091,
        msg: 'boom',
        err: { message: 'boom', stack: 'Error: boom\n    at somewhere' },
      }),
    );
    expect(line).toContain('ERROR boom');
    expect(line).toContain('    at somewhere');
  });

  it('passes non-pino output through untouched', () => {
    expect(formatLogLine('plain text\n')).toBe('plain text\n');
    expect(formatLogLine('{"json":"but not a log"}')).toBe('{"json":"but not a log"}');
  });
});
