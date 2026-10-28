import { useQuery } from "@tanstack/react-query";
import { Link, NavLink, Outlet, useNavigate } from "react-router";
import { buttonClass } from "../components/common/Button";
import { LANGUAGE_OPTIONS, useT, type Lang } from "../i18n";
import { notificationsApi } from "../services/lms";
import { useAuth } from "../store/auth";
import { useTheme } from "../store/theme";

const navLink = ({ isActive }: { isActive: boolean }) =>
  `py-1 text-sm ${isActive ? "border-b-2 border-pen font-medium" : "text-muted hover:text-ink"}`;

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const { t } = useT();
  const label = theme === "dark" ? t("theme.toLight") : t("theme.toDark");
  return (
    <button type="button" onClick={toggle} aria-label={label} title={label} className="grid h-8 w-8 place-items-center rounded-md border border-line text-ink hover:border-pen">
      {theme === "dark" ? (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
    </button>
  );
}

export default function AppLayout() {
  const { user, logout, hasRole } = useAuth();
  const { t, lang, setLang } = useT();
  const navigate = useNavigate();
  // The bell checks for news every 30 seconds while you're signed in.
  const unread = useQuery({ queryKey: ["notifications-unread"], queryFn: notificationsApi.unreadCount, enabled: !!user, refetchInterval: 30_000, retry: false });
  const count = unread.data?.unread ?? 0;

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="skip-link">
        {t("a11y.skip")}
      </a>
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-2 px-4 py-3">
          <Link to="/courses" className="text-lg font-bold tracking-tight text-pen">
            Vertexon
          </Link>
          <nav className="flex flex-1 gap-6" aria-label={t("nav.main")}>
            <NavLink to="/courses" className={navLink}>
              {t("nav.courses")}
            </NavLink>
            {hasRole("student") && (
              <NavLink to="/dashboard" className={navLink}>
                {t("nav.myLearning")}
              </NavLink>
            )}
            {hasRole("instructor", "admin") && (
              <NavLink to="/teach" className={navLink}>
                {t("nav.teaching")}
              </NavLink>
            )}
            {hasRole("admin") && (
              <NavLink to="/admin" className={navLink}>
                {t("nav.admin")}
              </NavLink>
            )}
          </nav>
          <div className="flex items-center gap-3 text-sm">
            <label className="sr-only" htmlFor="lang">
              {t("lang.label")}
            </label>
            <select id="lang" value={lang} onChange={(e) => setLang(e.target.value as Lang)} className="rounded-md border border-line bg-white px-2 py-1 text-sm text-ink">
              {LANGUAGE_OPTIONS.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
            <ThemeToggle />
          </div>
          {user ? (
            <div className="flex items-center gap-4 text-sm">
              <Link to="/notifications" className="text-pen hover:underline" aria-label={count ? t("nav.notificationsUnread", { n: count }) : t("nav.notifications")}>
                {t("nav.notifications")}
                {count > 0 && <span aria-hidden className="ml-1.5 inline-block min-w-5 rounded-full bg-highlight px-1.5 text-center text-xs font-semibold text-black">{count > 99 ? "99+" : count}</span>}
              </Link>
              <span className="text-muted">{user.full_name}</span>
              <button
                className="text-pen hover:underline"
                onClick={async () => {
                  await logout();
                  navigate("/login");
                }}
              >
                {t("nav.logout")}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3 text-sm">
              <Link to="/login" className="text-pen hover:underline">
                {t("nav.login")}
              </Link>
              <Link to="/register" className={buttonClass("primary")}>
                {t("nav.signup")}
              </Link>
            </div>
          )}
        </div>
      </header>
      {/* tabIndex=-1 lets the skip link move keyboard focus here. */}
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 outline-none">
        <Outlet />
      </main>
    </div>
  );
}
