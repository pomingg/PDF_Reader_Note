import { Reader } from "@/components/reader/Reader";

export default async function ReadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Reader docId={id} />;
}
