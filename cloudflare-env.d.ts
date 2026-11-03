/// <reference types="vinext/types" />
/// <reference types="vite/client" />
declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
  }
}
