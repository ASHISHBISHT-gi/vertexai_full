// These mirror the JSON the backend returns. If the API changes, TypeScript will point
// at every place in the UI that needs updating.
export type Role = "student" | "instructor" | "admin";
export type Difficulty = "beginner" | "intermediate" | "advanced";
export type CourseStatus = "pending" | "approved" | "rejected" | "archived";

export interface User {
  id: string;
  full_name: string;
  email: string;
  role: Role; // the "main" role, for display and redirects
  roles: Role[]; // every role, for permission checks
}

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: User;
}

export interface CourseSummary {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  difficulty: Difficulty | null;
  thumbnail_url: string | null;
  price: number;
  status: CourseStatus;
  instructor_name: string;
  rating_avg?: number; // only on the catalog and course page
  rating_count?: number;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface CatalogResponse {
  data: CourseSummary[];
  pagination: Pagination;
}

export interface Lecture {
  id: string;
  title: string;
  duration_seconds: number | null;
  order_index: number;
  has_video: boolean;
  video_url?: string | null; // only present when you're enrolled / own the course
  has_transcript?: boolean; // instructors only
  ai_indexed?: boolean; // instructors only: has the AI tutor read the transcript?
}

export interface CourseModule {
  id: string;
  title: string;
  order_index: number;
  lectures: Lecture[];
}

export interface CourseDetail extends CourseSummary {
  is_enrolled: boolean;
  can_edit: boolean;
  modules: CourseModule[];
}

export interface InstructorCourse extends CourseSummary {
  enrollment_count: number;
}

export interface Enrollment {
  id: string;
  enrolled_at: string;
  progress_percent: number;
  course: Pick<CourseSummary, "id" | "title" | "thumbnail_url" | "category" | "difficulty" | "instructor_name">;
}

export interface NewCourse {
  title: string;
  description?: string;
  category?: string;
  difficulty?: Difficulty;
  price?: number;
}

// ---------- Week 2: learning ----------
export interface LearnLecture {
  id: string;
  title: string;
  duration_seconds: number | null;
  has_video: boolean;
  position_seconds: number;
  completed: boolean;
}
export interface LearnModule {
  id: string;
  title: string;
  lectures: LearnLecture[];
}
export interface LearnOutline {
  course: { id: string; title: string; status: CourseStatus };
  enrollment: { id: string; progress_percent: number } | null;
  is_preview: boolean; // instructors/admins looking at their own course
  modules: LearnModule[];
  resume_lecture_id: string | null;
  certificate: { id: string; code: string } | null;
}
export interface Playback {
  url: string;
  expires_in: number | null;
  external: boolean;
}
export interface ProgressResult {
  position_seconds: number;
  completed: boolean;
  progress_percent: number;
  certificate: { id: string } | null;
  new_badges: string[];
}
export interface Note {
  id: string;
  timestamp_seconds: number;
  content: string;
  created_at: string;
}
export interface Bookmark {
  id: string;
  timestamp_seconds: number;
  created_at: string;
}

// ---------- assignments ----------
export interface RubricItem {
  criterion: string;
  points: number;
}
export interface StudentAssignment {
  id: string;
  title: string;
  instructions: string | null;
  rubric: RubricItem[] | null;
  due_date: string | null;
  max_points: number;
  is_past_due: boolean;
  status: "missing" | "submitted" | "graded";
  submission: { id: string; original_name: string; submitted_at: string; grade: number | null; feedback: string | null } | null;
}
export interface OwnerAssignment {
  id: string;
  title: string;
  instructions: string | null;
  rubric: RubricItem[] | null;
  due_date: string | null;
  max_points: number;
  submission_count: number;
  ungraded_count: number;
}
export interface Submission {
  id: string;
  student_name: string;
  student_email: string;
  original_name: string;
  file_size: number;
  submitted_at: string;
  grade: number | null;
  feedback: string | null;
}

// ---------- quizzes ----------
export type QuestionType = "mcq" | "multi_select" | "short_answer";
export interface QuizSummary {
  id: string;
  title: string;
  is_published: boolean;
  is_ai_generated: boolean;
  module_id: string;
  module_title: string;
  question_count: number;
  attempts: number;
  best_score: number | null;
}
export interface QuizQuestion {
  id: string;
  question_text: string;
  question_type: QuestionType;
  points: number;
  options: { id: string; option_text: string }[];
}
export interface Quiz {
  id: string;
  title: string;
  course_id: string;
  questions: QuizQuestion[];
}
export interface AttemptResult {
  attempt_id: string;
  score: number | null;
  earned: number;
  possible: number;
  ungraded_count: number;
  results: {
    question_id: string;
    correct: boolean | null;
    selected_option_ids: string[];
    text_answer: string | null;
    correct_option_ids: string[];
    accepted_answers: string[];
  }[];
  new_badges: string[];
}
export interface NewQuiz {
  module_id: string;
  title: string;
  is_ai_generated?: boolean;
  generated_from_lecture_id?: string;
  questions: {
    question_text: string;
    question_type: QuestionType;
    points?: number;
    options?: { option_text: string; is_correct: boolean }[];
    accepted_answers?: string[];
  }[];
}

// ---------- gamification, certificates, analytics ----------
export interface CertificateItem {
  id: string;
  code: string;
  issued_at: string;
  course_id: string;
  course_title: string;
}
export interface Badge {
  code: string;
  name: string;
  description: string;
  earned_at: string | null;
}
export interface Streak {
  current_streak: number;
  longest_streak: number;
  last_active_date: string | null;
  active_today: boolean;
}
export interface Analytics {
  course: { id: string; title: string };
  enrolled: number;
  completed: number;
  avg_progress: number;
  total_watched_seconds: number;
  lectures: { id: string; title: string; module_title: string; duration_seconds: number | null; started: number; completed: number }[];
  quizzes: { id: string; title: string; is_published: boolean; attempts: number; students: number; avg_score: number | null }[];
  assignments: { id: string; title: string; max_points: number; submitted: number; graded: number; avg_grade_percent: number | null }[];
}

// ---------- Week 3: AI tutor ----------
export type TutorMode = "auto" | "beginner" | "intermediate" | "advanced";
export interface AiStatus {
  llm_provider: string;
  embedding_provider: string;
  demo: boolean; // true = no real AI: answers are assembled from the transcripts by simple rules
}
export interface CourseAiStatus {
  ready: boolean;
  lectures: { id: string; title: string; module_id: string; module_title: string; has_transcript: boolean; indexed: boolean; chunks: number }[];
}
export interface TutorSource {
  ref: number; // the [1], [2] marker in the answer
  lecture_id: string;
  lecture_title: string;
  timestamp_seconds: number | null;
  snippet: string;
}
export interface ChatSession {
  id: string;
  course_id: string;
  mode: TutorMode;
  created_at: string;
  updated_at: string;
  message_count?: number;
}
export interface ChatMessage {
  id: string;
  sender: "user" | "ai";
  content: string;
  sources: TutorSource[] | null;
  created_at: string;
}
export interface TutorReply {
  id: string;
  reply: string;
  sources: TutorSource[];
  mode: TutorMode;
  level: string | null;
}
export interface Summary {
  summary: string;
  key_points: string[];
  level: string;
  cached: boolean;
  demo: boolean;
}
export interface Flashcard {
  id: string;
  question: string;
  answer: string;
}
export interface StudyPlanStep {
  title: string;
  why: string;
  action: string;
  estimated_minutes: number;
  module_id: string | null;
}
export interface StudyPlan {
  summary: string;
  steps: StudyPlanStep[];
}
export interface QuizDraft {
  title: string;
  module_id: string;
  generated_from_lecture_id: string;
  is_ai_generated: true;
  demo: boolean;
  questions: NewQuiz["questions"];
}
export interface MasteryItem {
  module_id: string;
  title: string;
  score: number | null;
  evidence_count: number;
}
export interface Recommendation {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  difficulty: Difficulty | null;
  price: number;
  thumbnail_url: string | null;
  instructor_name: string;
  score: number;
  reason: string;
}

// ---------- Week 4a: admin, notifications, reviews, materials ----------
export interface Paged<T> {
  data: T[];
  pagination: Pagination;
}
export interface AdminUser {
  id: string;
  full_name: string;
  email: string;
  is_active: boolean;
  created_at: string;
  roles: Role[];
  course_count: number;
  enrollment_count: number;
}
export interface AdminCourse {
  id: string;
  title: string;
  category: string | null;
  difficulty: Difficulty | null;
  price: number;
  status: CourseStatus;
  created_at: string;
  instructor_name: string;
  instructor_email: string;
  module_count: number;
  lecture_count: number;
  video_count: number;
  enrollment_count: number;
  last_review_comment: string | null;
}
export interface DayCount {
  day: string; // YYYY-MM-DD
  n: number;
}
export interface Overview {
  users_total: number;
  users_suspended: number;
  new_users_7d: number;
  active_today: number;
  active_7d: number;
  enrollments_total: number;
  enrollments_7d: number;
  completed_enrollments: number;
  completion_rate: number;
  estimated_revenue: number;
  certificates_issued: number;
  tutor_questions_7d: number;
  courses_by_status: Record<string, number>;
  users_by_role: Record<string, number>;
  enrollments_per_day: DayCount[];
  signups_per_day: DayCount[];
  tutor_questions_per_day: DayCount[];
  top_courses: { id: string; title: string; instructor_name: string; enrollments: number; avg_progress: number; rating: number | null }[];
}
export interface AuditEntry {
  id: string;
  action: string;
  entity: string | null;
  entity_id: string | null;
  metadata: Record<string, any>;
  created_at: string;
  actor_name: string | null;
}
export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  is_read: boolean;
  created_at: string;
}
export interface ReviewSummary {
  average: number;
  count: number;
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
}
export interface Review {
  id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  author_name: string;
  mine: boolean;
}
export interface Resource {
  id: string;
  original_name: string;
  file_size: number;
  created_at: string;
}

// ---------- Week 4b: community ----------
export interface ThreadSummary {
  id: string;
  title: string;
  is_pinned: boolean;
  created_at: string;
  last_activity_at: string;
  author_name: string;
  by_instructor: boolean;
  reply_count: number;
  has_flagged: boolean; // only true for moderators
}
export interface ThreadList {
  data: ThreadSummary[];
  pagination: Pagination;
  can_moderate: boolean;
}
export interface ForumPost {
  id: string;
  parent_id: string | null;
  content: string;
  created_at: string;
  author_name: string;
  by_instructor: boolean;
  mine: boolean;
  is_flagged: boolean; // only true for moderators
  report_count: number; // only non-zero for moderators
  reported_by_me: boolean;
}
export interface ThreadDetail {
  thread: { id: string; title: string; is_pinned: boolean; created_at: string; author_name: string; by_instructor: boolean; course_id: string; course_title: string };
  posts: ForumPost[];
  can_moderate: boolean;
}
export interface Announcement {
  id: string;
  title: string;
  content: string;
  created_at: string;
  posted_by_name: string;
}
export interface AnnouncementList {
  data: Announcement[];
  pagination: Pagination;
  can_post: boolean;
}
export interface LeaderboardRow {
  rank: number;
  name: string;
  points: number;
  quiz_points: number;
  lectures_completed: number;
  progress_percent: number;
  mine: boolean;
}
export interface Leaderboard {
  top: LeaderboardRow[];
  me: LeaderboardRow | null; // your row when you're not in the top 10
  participants: number;
  how_points_work: string;
}
export interface FlaggedPost {
  id: string;
  content: string;
  created_at: string;
  thread_id: string;
  thread_title: string;
  course_id: string;
  course_title: string;
  author_name: string | null;
  author_email: string | null;
  report_count: number;
  reasons: string[];
}
