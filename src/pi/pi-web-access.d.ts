// pi-web-access ships its extension as a built entry file without type declarations.
declare module "pi-web-access/dist/index.js" {
	import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
	const factory: ExtensionFactory;
	export default factory;
}
