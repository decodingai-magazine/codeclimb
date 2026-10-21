import { NextResponse } from "next/server";
import { inngest } from "@/inngest/client";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { ids } = await inngest.send({
    name: "test/hello.world",
    data: { name: body.name ?? "world" },
  });

  return NextResponse.json({ ids });
}
