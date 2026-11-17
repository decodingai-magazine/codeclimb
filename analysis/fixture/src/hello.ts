// Placeholder: one Inngest function, served at http://localhost:3000/api/inngest.
//   npm run hello          serves it
//   npm run dev:inngest    the dev server, pointed at that URL
import http from "node:http";
import { Inngest } from "inngest";
import { serve } from "inngest/node";

const inngest = new Inngest({ id: "codeclimb" });

const helloWorld = inngest.createFunction(
  { id: "hello-world", triggers: [{ event: "test/hello.world" }] },
  async ({ event }) => ({ message: `Hello ${event.data.name ?? "world"}!` }),
);

const handler = serve({ client: inngest, functions: [helloWorld] });

http
  .createServer((req, res) => {
    if (req.url?.startsWith("/api/inngest")) return handler(req, res);
    res.writeHead(404).end();
  })
  .listen(3000, () => console.log("[hello] serving hello-world at http://localhost:3000/api/inngest"));
