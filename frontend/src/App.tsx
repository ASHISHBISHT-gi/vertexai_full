import { Navigate, Route, Routes } from "react-router";
import AppLayout from "./layouts/AppLayout";
import ActivityPage from "./pages/admin/ActivityPage";
import AdminCoursesPage from "./pages/admin/CoursesPage";
import AdminLayout from "./pages/admin/AdminLayout";
import AdminModerationPage from "./pages/admin/ModerationPage";
import AdminOverviewPage from "./pages/admin/OverviewPage";
import AdminUsersPage from "./pages/admin/UsersPage";
import NotificationsPage from "./pages/NotificationsPage";
import LoginPage from "./pages/auth/LoginPage";
import RegisterPage from "./pages/auth/RegisterPage";
import CoursePlayerPage from "./pages/course-player/CoursePlayerPage";
import CatalogPage from "./pages/course-catalog/CatalogPage";
import CourseDetailPage from "./pages/course-catalog/CourseDetailPage";
import DashboardPage from "./pages/dashboard/DashboardPage";
import CourseManagePage from "./pages/instructor/CourseManagePage";
import QuizPage from "./pages/quizzes/QuizPage";
import InstructorCoursesPage from "./pages/instructor/InstructorCoursesPage";
import NotFoundPage from "./pages/NotFoundPage";
import { ProtectedRoute } from "./routes/ProtectedRoute";

export default function App() {
  return (
    <Routes>
      {/* Every page shares the header via AppLayout (its <Outlet/> is where the page renders). */}
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/courses" replace />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="register" element={<RegisterPage />} />
        <Route path="courses" element={<CatalogPage />} />
        <Route path="courses/:id" element={<CourseDetailPage />} />

        <Route element={<ProtectedRoute roles={["student"]} />}>
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="quizzes/:id" element={<QuizPage />} />
        </Route>
        {/* Students learn here; instructors and admins can preview their own course in the same player. */}
        <Route element={<ProtectedRoute roles={["student", "instructor", "admin"]} />}>
          <Route path="learn/:courseId" element={<CoursePlayerPage />} />
        </Route>
        <Route element={<ProtectedRoute roles={["instructor", "admin"]} />}>
          <Route path="teach" element={<InstructorCoursesPage />} />
          <Route path="teach/courses/:id" element={<CourseManagePage />} />
        </Route>

        <Route element={<ProtectedRoute />}>
          <Route path="notifications" element={<NotificationsPage />} />
        </Route>
        <Route element={<ProtectedRoute roles={["admin"]} />}>
          <Route path="admin" element={<AdminLayout />}>
            <Route index element={<AdminOverviewPage />} />
            <Route path="courses" element={<AdminCoursesPage />} />
            <Route path="users" element={<AdminUsersPage />} />
            <Route path="moderation" element={<AdminModerationPage />} />
            <Route path="activity" element={<ActivityPage />} />
          </Route>
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
