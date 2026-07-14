import { ChevronLeft } from "lucide-react";
import { Link } from "react-router";

/** Consistent page heading with an optional generous back button. */
export function PageHeader({
  title,
  subtitle,
  backTo,
  backLabel,
  actions,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  backTo?: string;
  backLabel?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6">
      {backTo && (
        <Link
          to={backTo}
          className="mb-3 inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 -ml-2.5 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800"
        >
          <ChevronLeft size={18} />
          {backLabel ?? "Back"}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-gray-900">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-gray-500">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

const AVATAR_COLORS = [
  "bg-indigo-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-sky-500",
  "bg-violet-500",
  "bg-teal-500",
  "bg-orange-500",
];

export function colorForName(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]!;
}

export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  return (
    <span
      title={name}
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${colorForName(name)} ${
        size === "sm" ? "size-6 text-[10px]" : "size-8 text-xs"
      }`}
    >
      {initials}
    </span>
  );
}

export function AvatarStack({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  return (
    <span className="flex -space-x-1.5">
      {names.slice(0, 4).map((n) => (
        <span key={n} className="rounded-full ring-2 ring-white">
          <Avatar name={n} size="sm" />
        </span>
      ))}
      {names.length > 4 && (
        <span className="z-10 inline-flex size-6 items-center justify-center rounded-full bg-gray-200 text-[10px] font-semibold text-gray-600 ring-2 ring-white">
          +{names.length - 4}
        </span>
      )}
    </span>
  );
}
