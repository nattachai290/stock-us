// pako ships no types and @types/pako isn't vendored here; only inflate is used.
declare module "pako" {
  export function inflate(data: Uint8Array): Uint8Array;
  const _default: { inflate: typeof inflate };
  export default _default;
}
