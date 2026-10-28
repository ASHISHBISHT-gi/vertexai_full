import { NavLink, Outlet } from "react-router";

const SECTIONS = [
  { to: "/admin", label: "Overview", end: true },
  { to: "/admin/courses", label: "Courses", end: false },
  { to: "/admin/users", label: "Users", end: false },
  { to: "/admin/moderation", label: "Moderation", end: false },
  { to: "/admin/activity", label: "Activity", end: false },
];

export default function AdminLayout() {
  return (
    <div>
      <h1 className="text-3xl font-semibold">Admin</h1>
      <nav aria-label="Admin sections" className="mt-5 flex gap-6 border-b border-line">
        {SECTIONS.map((s) => (
          <NavLink
            key={s.to}
            to={s.to}
            end={s.end}
            className={({ isActive }) => `pb-2 text-sm ${isActive ? "border-b-2 border-pen font-medium" : "text-muted hover:text-ink"}`}
          >
            {s.label}
          </NavLink>
        ))}
      </nav>
      <div className="mt-6">
        <Outlet />
      </div>
    </div>
  );
}
