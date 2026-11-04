// Copy pdf.js worker, CMaps (CJK fonts) and standard fonts into public/pdfjs
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "pdfjs-dist");
const dest = join(root, "public", "pdfjs");
if (!existsSync(src)) process.exit(0);
mkdirSync(dest, { recursive: true });
cpSync(join(src, "build", "pdf.worker.min.mjs"), join(dest, "pdf.worker.min.mjs"));
cpSync(join(src, "cmaps"), join(dest, "cmaps"), { recursive: true });
cpSync(join(src, "standard_fonts"), join(dest, "standard_fonts"), { recursive: true });
console.log("pdf.js assets copied to public/pdfjs");
