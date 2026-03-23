import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";

const ROOT = process.cwd();

async function readTextFile(name: string): Promise<string | null> {
  try {
    return await readFile(join(ROOT, name), "utf-8");
  } catch {
    return null;
  }
}

async function readJsonFile(name: string): Promise<unknown> {
  try {
    const raw = await readFile(join(ROOT, name), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export const dynamic = "force-dynamic";

export async function GET() {
  const [progress, backlog, heartbeat] = await Promise.all([
    readTextFile("claude-progress.txt"),
    readJsonFile("feature-backlog.json"),
    readJsonFile("agent-heartbeat.json"),
  ]);

  return NextResponse.json({ progress, backlog, heartbeat });
}
