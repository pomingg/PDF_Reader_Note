import { handle, json } from "@/lib/api";
import { listTags } from "@/lib/notes";

export const GET = handle(() => json(listTags()));
