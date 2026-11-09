// pi-web-access ships a bundled extension without type declarations.
declare module "pi-web-access/dist/index.js" {
  import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
  const factory: ExtensionFactory;
  export default factory;
}
