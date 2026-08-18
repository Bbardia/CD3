/** Structural view of the compiled API entry, enough for the shell without fastify's types. */
declare module '@cd3/api/dist/app.js' {
  import type { Server } from 'node:http';

  export function buildServer(): {
    listen(options: { host: string; port: number }): Promise<string>;
    close(): Promise<void>;
    readonly server: Server;
  };
}
