import { EmptyState } from "@/components/ui/feedback";

export function MyWorkPage() {
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-gray-900">My Work</h1>
      <EmptyState title="Nothing here yet" hint="Tasks assigned to you will appear here (M2)." />
    </div>
  );
}
