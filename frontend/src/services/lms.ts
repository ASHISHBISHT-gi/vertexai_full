import { api, downloadFile, toQuery } from "./api";
import type {
  AdminCourse, AdminUser, AppNotification, AuditEntry, Overview, Paged, Resource, Review, ReviewSummary, Role,
  AiStatus, Analytics, AttemptResult, ChatMessage, ChatSession, CourseAiStatus, Flashcard, MasteryItem, QuizDraft, Recommendation,
  Announcement, AnnouncementList, FlaggedPost, Leaderboard, ThreadDetail, ThreadList,
  StudyPlan, Summary, TutorMode, TutorReply, AuthResponse, Badge, Bookmark, CatalogResponse, CertificateItem, CourseDetail, CourseSummary,
  Enrollment, InstructorCourse, LearnOutline, NewCourse, NewQuiz, Note, OwnerAssignment, Playback, ProgressResult, Quiz,
  QuizSummary, Streak, StudentAssignment, Submission, User,
} from "./types";

export const authApi = {
  register: (body: { full_name: string; email: string; password: string }) =>
    api<AuthResponse>("/auth/register", { method: "POST", body }),
  login: (body: { email: string; password: string }) => api<AuthResponse>("/auth/login", { method: "POST", body }),
  logout: (refresh_token: string) => api<void>("/auth/logout", { method: "POST", body: { refresh_token } }),
  me: () => api<User>("/auth/me"),
};

export const coursesApi = {
  list: (params: { q?: string; category?: string; difficulty?: string; min_rating?: string; page?: number; limit?: number }) =>
    api<CatalogResponse>(`/courses${toQuery(params)}`),
  get: (id: string) => api<CourseDetail>(`/courses/${id}`),
  create: (body: NewCourse) => api<CourseSummary>("/courses", { method: "POST", body }),
  mine: () => api<InstructorCourse[]>("/instructor/courses"),
  update: (id: string, body: Partial<NewCourse>) => api<CourseSummary>(`/courses/${id}`, { method: "PUT", body }),
  uploadThumbnail: (id: string, file: File) => {
    const form = new FormData();
    form.append("image", file);
    return api<{ id: string; thumbnail_url: string }>(`/courses/${id}/thumbnail`, { method: "POST", body: form });
  },
};

export const enrollmentsApi = {
  enroll: (courseId: string) => api<{ id: string }>(`/courses/${courseId}/enroll`, { method: "POST" }),
  mine: () => api<Enrollment[]>("/enrollments/me"),
};

// ---------- Week 2 ----------
export const learningApi = {
  outline: (courseId: string) => api<LearnOutline>(`/courses/${courseId}/learn`),
  playback: (lectureId: string) => api<Playback>(`/lectures/${lectureId}/playback`, { method: "POST" }),
  saveProgress: (lectureId: string, body: { position_seconds: number; completed?: boolean }) =>
    api<ProgressResult>(`/lectures/${lectureId}/progress`, { method: "POST", body }),
  notes: (lectureId: string) => api<Note[]>(`/lectures/${lectureId}/notes`),
  addNote: (lectureId: string, body: { timestamp_seconds: number; content: string }) =>
    api<Note>(`/lectures/${lectureId}/notes`, { method: "POST", body }),
  deleteNote: (id: string) => api<void>(`/notes/${id}`, { method: "DELETE" }),
  bookmarks: (lectureId: string) => api<Bookmark[]>(`/lectures/${lectureId}/bookmarks`),
  addBookmark: (lectureId: string, timestamp_seconds: number) =>
    api<Bookmark>(`/lectures/${lectureId}/bookmarks`, { method: "POST", body: { timestamp_seconds } }),
  deleteBookmark: (id: string) => api<void>(`/bookmarks/${id}`, { method: "DELETE" }),
};

export const assignmentsApi = {
  forStudent: (courseId: string) => api<StudentAssignment[]>(`/courses/${courseId}/assignments`),
  forOwner: (courseId: string) => api<OwnerAssignment[]>(`/courses/${courseId}/assignments`),
  create: (body: { course_id: string; title: string; instructions?: string; due_date?: string; max_points?: number; rubric?: { criterion: string; points: number }[] }) =>
    api<OwnerAssignment>("/assignments", { method: "POST", body }),
  remove: (id: string) => api<void>(`/assignments/${id}`, { method: "DELETE" }),
  submit: (id: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api<{ id: string }>(`/assignments/${id}/submit`, { method: "POST", body: form });
  },
  submissions: (id: string) => api<Submission[]>(`/assignments/${id}/submissions`),
  grade: (submissionId: string, body: { grade: number; feedback?: string }) =>
    api<{ id: string }>(`/submissions/${submissionId}/grade`, { method: "PUT", body }),
  download: (submissionId: string, name: string) => downloadFile(`/submissions/${submissionId}/file`, name),
};

export const quizzesApi = {
  forCourse: (courseId: string) => api<QuizSummary[]>(`/courses/${courseId}/quizzes`),
  get: (id: string) => api<Quiz>(`/quizzes/${id}`),
  start: (id: string) => api<{ attempt_id: string }>(`/quizzes/${id}/attempt`, { method: "POST" }),
  submit: (attemptId: string, answers: { question_id: string; selected_option_ids?: string[]; text_answer?: string }[]) =>
    api<AttemptResult>(`/attempts/${attemptId}/submit`, { method: "POST", body: { answers } }),
  create: (body: NewQuiz) => api<{ id: string }>("/quizzes", { method: "POST", body }),
  setPublished: (id: string, is_published: boolean) => api<{ id: string }>(`/quizzes/${id}`, { method: "PUT", body: { is_published } }),
  remove: (id: string) => api<void>(`/quizzes/${id}`, { method: "DELETE" }),
};

export const certificatesApi = {
  mine: () => api<CertificateItem[]>("/certificates/me"),
  download: (id: string) => downloadFile(`/certificates/${id}/download`, "certificate.pdf"),
};

export const gamificationApi = {
  badges: () => api<Badge[]>("/users/me/badges"),
  streak: () => api<Streak>("/users/me/streak"),
};

/** Instructor authoring: modules, lectures, video files, analytics. */
export const contentApi = {
  addModule: (courseId: string, title: string) => api<{ id: string }>(`/courses/${courseId}/modules`, { method: "POST", body: { title } }),
  addLecture: (moduleId: string, title: string) => api<{ id: string }>(`/modules/${moduleId}/lectures`, { method: "POST", body: { title } }),
  uploadVideo: (lectureId: string, file: File, durationSeconds?: number) => {
    const form = new FormData();
    if (durationSeconds) form.append("duration_seconds", String(durationSeconds));
    form.append("video", file);
    return api<{ id: string }>(`/lectures/${lectureId}/video`, { method: "POST", body: form });
  },
  deleteLecture: (id: string) => api<void>(`/lectures/${id}`, { method: "DELETE" }),
  getTranscript: (lectureId: string) =>
    api<{ transcript: string; indexed_chunks: number; ai_indexed: boolean }>(`/lectures/${lectureId}/transcript`),
  saveTranscript: (lectureId: string, transcript: string) =>
    api<{ id: string; has_transcript: boolean }>(`/lectures/${lectureId}/transcript`, { method: "PUT", body: { transcript } }),
  deleteModule: (id: string) => api<void>(`/modules/${id}`, { method: "DELETE" }),
  analytics: (courseId: string) => api<Analytics>(`/instructor/courses/${courseId}/analytics`),
};

export const learnExtrasApi = {
  mastery: (courseId: string) => api<MasteryItem[]>(`/courses/${courseId}/mastery`),
  recommendations: () => api<Recommendation[]>("/recommendations/me"),
};

/** The Python AI service (same login token). Paths start with /ai/ so api.ts knows where to send them. */
export const aiApi = {
  status: () => api<AiStatus>("/ai/status"),
  courseStatus: (courseId: string) => api<CourseAiStatus>(`/ai/courses/${courseId}/status`),
  indexLecture: (lectureId: string) => api<{ chunks: number; indexed: boolean }>(`/ai/lectures/${lectureId}/index`, { method: "POST" }),
  sessions: (courseId: string) => api<ChatSession[]>(`/ai/chat/sessions?course_id=${courseId}`),
  createSession: (course_id: string, mode: TutorMode) => api<ChatSession>("/ai/chat/sessions", { method: "POST", body: { course_id, mode } }),
  messages: (sessionId: string) => api<ChatMessage[]>(`/ai/chat/sessions/${sessionId}/messages`),
  send: (sessionId: string, message: string) => api<TutorReply>(`/ai/chat/sessions/${sessionId}/messages`, { method: "POST", body: { message } }),
  setMode: (sessionId: string, mode: TutorMode) => api<{ mode: TutorMode }>(`/ai/chat/sessions/${sessionId}/mode`, { method: "PUT", body: { mode } }),
  summarize: (lectureId: string, level: string) => api<Summary>(`/ai/lectures/${lectureId}/summarize`, { method: "POST", body: { level } }),
  flashcards: (moduleId: string) => api<{ cards: Flashcard[] }>(`/ai/modules/${moduleId}/flashcards`),
  makeFlashcards: (moduleId: string, count = 10) => api<{ cards: Flashcard[]; generated: boolean }>(`/ai/modules/${moduleId}/flashcards`, { method: "POST", body: { count } }),
  studyPlan: (courseId: string) => api<{ plan: StudyPlan | null; generated_at: string | null }>(`/ai/study-plan?course_id=${courseId}`),
  makeStudyPlan: (course_id: string) => api<{ plan: StudyPlan; generated_at: string }>("/ai/study-plan", { method: "POST", body: { course_id } }),
  generateQuiz: (lectureId: string, num_questions: number, difficulty: string) =>
    api<QuizDraft>(`/ai/lectures/${lectureId}/generate-quiz`, { method: "POST", body: { num_questions, difficulty } }),
};

// ---------- Week 4a ----------
export const adminApi = {
  users: (p: { q?: string; role?: string; status?: string; page?: number }) => api<Paged<AdminUser>>(`/admin/users${toQuery(p)}`),
  setRoles: (id: string, roles: Role[]) => api<{ roles: Role[] }>(`/admin/users/${id}/role`, { method: "PUT", body: { roles } }),
  setSuspended: (id: string, suspended: boolean, reason?: string) => api<{ is_active: boolean }>(`/admin/users/${id}/suspend`, { method: "PUT", body: { suspended, reason } }),
  deleteUser: (id: string, confirmEmail: string) => api<void>(`/admin/users/${id}${toQuery({ confirm_email: confirmEmail })}`, { method: "DELETE" }),
  courses: (p: { status?: string; q?: string; page?: number }) => api<Paged<AdminCourse>>(`/admin/courses${toQuery(p)}`),
  decide: (courseId: string, decision: "approved" | "rejected", comment?: string) =>
    api<{ id: string; status: string }>(`/courses/${courseId}/approve`, { method: "POST", body: { decision, comment } }),
  overview: () => api<Overview>("/admin/analytics/overview"),
  audit: (p: { action?: string; page?: number }) => api<Paged<AuditEntry>>(`/admin/audit-logs${toQuery(p)}`),
};

export const notificationsApi = {
  list: (p: { unread?: string; page?: number }) => api<{ data: AppNotification[]; unread: number; pagination: Paged<AppNotification>["pagination"] }>(`/notifications${toQuery(p)}`),
  unreadCount: () => api<{ unread: number }>("/notifications/unread-count"),
  markRead: (id: string) => api<{ id: string }>(`/notifications/${id}/read`, { method: "PUT" }),
  markAllRead: () => api<{ updated: number }>("/notifications/read-all", { method: "PUT" }),
  preferences: () => api<{ email_notifications: boolean }>("/notifications/preferences"),
  setPreferences: (email_notifications: boolean) => api<{ email_notifications: boolean }>("/notifications/preferences", { method: "PUT", body: { email_notifications } }),
};

export const reviewsApi = {
  list: (courseId: string) => api<{ summary: ReviewSummary; items: Review[]; can_review: boolean }>(`/courses/${courseId}/reviews`),
  save: (courseId: string, body: { rating: number; comment?: string }) => api<{ id: string }>(`/courses/${courseId}/reviews`, { method: "PUT", body }),
  remove: (id: string) => api<void>(`/reviews/${id}`, { method: "DELETE" }),
};

export const resourcesApi = {
  list: (lectureId: string) => api<Resource[]>(`/lectures/${lectureId}/resources`),
  upload: (lectureId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api<Resource>(`/lectures/${lectureId}/resources`, { method: "POST", body: form });
  },
  remove: (id: string) => api<void>(`/resources/${id}`, { method: "DELETE" }),
  download: (id: string, name: string) => downloadFile(`/resources/${id}/file`, name),
};

// ---------- Week 4b ----------
export const communityApi = {
  threads: (courseId: string, p: { q?: string; page?: number }) => api<ThreadList>(`/courses/${courseId}/threads${toQuery(p)}`),
  createThread: (courseId: string, body: { title: string; content: string }) => api<{ id: string }>(`/courses/${courseId}/threads`, { method: "POST", body }),
  thread: (id: string) => api<ThreadDetail>(`/threads/${id}`),
  reply: (threadId: string, body: { content: string; parent_id?: string }) => api<{ id: string }>(`/threads/${threadId}/posts`, { method: "POST", body }),
  pin: (threadId: string, pinned: boolean) => api<{ id: string; is_pinned: boolean }>(`/threads/${threadId}/pin`, { method: "PUT", body: { pinned } }),
  deleteThread: (threadId: string) => api<void>(`/threads/${threadId}`, { method: "DELETE" }),
  deletePost: (postId: string) => api<{ thread_deleted: boolean }>(`/posts/${postId}`, { method: "DELETE" }),
  report: (postId: string, reason?: string) => api<{ reported: boolean }>(`/posts/${postId}/report`, { method: "POST", body: { reason } }),
  dismissReports: (postId: string) => api<{ id: string }>(`/posts/${postId}/dismiss-reports`, { method: "PUT" }),
  announcements: (courseId: string, page?: number) => api<AnnouncementList>(`/courses/${courseId}/announcements${toQuery({ page })}`),
  postAnnouncement: (courseId: string, body: { title: string; content: string }) => api<Announcement & { notified: number }>(`/courses/${courseId}/announcements`, { method: "POST", body }),
  deleteAnnouncement: (id: string) => api<void>(`/announcements/${id}`, { method: "DELETE" }),
  leaderboard: (courseId: string) => api<Leaderboard>(`/leaderboard/${courseId}`),
  flagged: (p: { page?: number }) => api<Paged<FlaggedPost>>(`/admin/moderation/flagged-posts${toQuery(p)}`),
};
