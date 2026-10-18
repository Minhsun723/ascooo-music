export interface Env {
  DB: D1Database;
  ARTWORK: R2Bucket;
  ANONYMOUS_LIMITER: RateLimit;
  WEBDAV_URL: string;
  MUSIC_ROOT: string;
  AAC51_ROOT?: string;
  WEBDAV_USERNAME?: string;
  WEBDAV_PASSWORD?: string;
  WEBDAV_BEARER_TOKEN?: string;
  WEBDAV_AUTH_MODE?: 'auto' | 'basic' | 'bearer';
  JWT_SECRET: string;
}

export interface SessionUser {
  id: number;
  username: string;
  role: 'admin' | 'user';
}

export type AppEnv = {
  Bindings: Env;
  Variables: { user: SessionUser };
};
