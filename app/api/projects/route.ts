import { handle, json } from "@/lib/api";
import { createProject, listProjects } from "@/lib/library";

export const GET = handle(() => json(listProjects()));
export const POST = handle(async (req: Request) => json(createProject(await req.json()), 201));
