import { handle, json } from "@/lib/api";
import { setDefaultProject } from "@/lib/integrations/hyread";
import { getProject } from "@/lib/library";

/** Body: { projectId } — which project newly synced books go into. */
export const PUT = handle(async (req: Request) => {
  const { projectId } = await req.json();
  if (projectId) getProject(projectId);
  setDefaultProject(projectId || null);
  return json({ ok: true });
});
