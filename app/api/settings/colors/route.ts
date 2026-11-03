import { handle, json } from "@/lib/api";
import { getColors, setColors } from "@/lib/notes";

export const GET = handle(() => json(getColors()));
export const PUT = handle(async (req: Request) => json(setColors(await req.json())));
