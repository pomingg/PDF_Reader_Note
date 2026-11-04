import { Suspense } from "react";
import { Sidebar } from "@/components/Sidebar";

export default function LibraryLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen">
      <Suspense fallback={<aside className="w-64 shrink-0 border-r border-slate-200 bg-white" />}>
        <Sidebar />
      </Suspense>
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
