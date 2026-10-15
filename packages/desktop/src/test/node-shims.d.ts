// The desktop workspace deliberately carries no `@types/node` (it is a DOM program), but the asset
// tests need three Node built-ins that vitest resolves at runtime. Typed here to the exact surface
// used rather than pulling the whole Node global scope into the renderer's program.
declare module "node:fs" {
  export function readFileSync(path: string): Uint8Array;
  // brand-rule.test.ts finds its specification, which lives outside the package root where Vite's `?raw`
  // glob is denied, in `.planning/phases/` or in an archived `.planning/milestones/*-phases/`.
  export function existsSync(path: string): boolean;
  export function globSync(pattern: string): string[];
}
declare module "node:zlib" {
  export function inflateSync(buf: Uint8Array): Uint8Array;
}
declare module "node:crypto" {
  export function createHash(alg: "sha1"): {
    update(data: Uint8Array | string): { digest(enc: "hex"): string };
  };
}
