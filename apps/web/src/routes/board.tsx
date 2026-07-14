import { EmptyState } from "@/components/ui/feedback";

export function BoardPage() {
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-gray-900">Board</h1>
      <EmptyState
        title="No projects yet"
        hint="Projects and their stage chains will appear here (M2)."
      />
    </div>
  );
}
