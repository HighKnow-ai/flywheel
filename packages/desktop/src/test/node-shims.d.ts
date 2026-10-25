// The desktop workspace deliberately carries no `@types/node` (it is a DOM program), but the asset
// tests need three Node built-ins that vitest resolves at runtime. Typed here to the exact surface
// used rather than pulling the whole Node global scope into the renderer's program.
declare module "node:fs" {
  export function readFileSync(path: string): Uint8Array;
}
declare module "node:zlib" {
  export function inflateSync(buf: Uint8Array): Uint8Array;
  export function brotliDecompressSync(buf: Uint8Array): Uint8Array;
}
declare module "node:crypto" {
  export function createHash(alg: "sha1"): {
    update(data: Uint8Array | string): { digest(enc: "hex"): string };
  };
}
