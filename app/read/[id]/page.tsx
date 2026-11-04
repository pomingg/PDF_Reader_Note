import { EbookView } from "@/components/reader/EbookView";
import { Reader } from "@/components/reader/Reader";
import { getDocument } from "@/lib/library";

export const dynamic = "force-dynamic";

export default async function ReadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let kind = "pdf";
  try {
    kind = getDocument(id).kind;
  } catch {
    /* unknown id: the reader shows the error */
  }
  return kind === "ebook" ? <EbookView docId={id} /> : <Reader docId={id} />;
}
