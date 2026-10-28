/**
 * End-to-end check of the backend (Weeks 1-4).
 * Run the server and `pnpm seed` first, then: pnpm smoke
 * The server must be started with RATE_LIMIT_ENABLED=false (this script logs in dozens of times from one IP).
 * To test the rate limiter itself, start the server normally and run:  RATE_LIMIT_CHECK=1 pnpm smoke
 */
const BASE = process.env.API_URL ?? "http://localhost:4000";
const PASSWORD = "Password123!";
let failures = 0;

function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) {
    failures++;
    if (detail !== undefined) console.log("      got:", JSON.stringify(detail));
  }
}

async function call(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: res.status, json };
}

const login = async (email: string) => (await call("POST", "/auth/login", { body: { email, password: PASSWORD } })).json;

async function main() {
  if (process.env.RATE_LIMIT_CHECK) return rateLimitCheck();
  const health = await fetch(`${BASE}/health`);
  check("GET /health returns ok (server + database reachable)", health.status === 200);

  // --- auth ---
  const email = `smoke+${Date.now()}@example.com`;
  let r = await call("POST", "/auth/register", { body: { full_name: "Smoke Test", email, password: PASSWORD } });
  check("register -> 201 with tokens and student role", r.status === 201 && !!r.json?.access_token && r.json?.user?.role === "student", r);
  const firstRefresh = r.json?.refresh_token;

  r = await call("POST", "/auth/register", { body: { full_name: "Smoke Test", email, password: PASSWORD } });
  check("register same email again -> 409", r.status === 409, r);

  r = await call("POST", "/auth/register", { body: { full_name: "X", email: "not-an-email", password: "short" } });
  check("register with bad input -> 400 VALIDATION_ERROR", r.status === 400 && r.json?.error?.code === "VALIDATION_ERROR", r);

  r = await call("POST", "/auth/login", { body: { email, password: "wrong-password" } });
  check("login with wrong password -> 401", r.status === 401, r);

  const student = await login(email);
  r = await call("GET", "/auth/me", { token: student.access_token });
  check("GET /auth/me with token -> 200", r.status === 200 && r.json?.email === email, r);
  r = await call("GET", "/auth/me");
  check("GET /auth/me without token -> 401", r.status === 401, r);

  r = await call("POST", "/auth/refresh", { body: { refresh_token: student.refresh_token } });
  check("refresh -> new tokens", r.status === 200 && !!r.json?.access_token, r);
  r = await call("POST", "/auth/refresh", { body: { refresh_token: student.refresh_token } });
  check("reusing a rotated refresh token -> 401", r.status === 401, r);
  r = await call("POST", "/auth/logout", { body: { refresh_token: firstRefresh } });
  check("logout -> 204", r.status === 204, r);
  r = await call("POST", "/auth/refresh", { body: { refresh_token: firstRefresh } });
  check("refresh after logout -> 401", r.status === 401, r);

  // --- roles (RBAC) ---
  r = await call("POST", "/courses", { token: student.access_token, body: { title: "Nope nope" } });
  check("student cannot create a course -> 403", r.status === 403, r);

  // --- instructor builds a course ---
  const instructor = await login("instructor@lms.dev");
  const title = `Smoke Course ${Date.now()}`;
  r = await call("POST", "/courses", { token: instructor.access_token, body: { title, description: "Created by the smoke test", category: "Testing", difficulty: "beginner", price: 0 } });
  check("instructor creates course -> 201, status pending", r.status === 201 && r.json?.status === "pending", r);
  const courseId = r.json?.id;

  r = await call("POST", "/courses", { token: instructor.access_token, body: { description: "no title" } });
  check("create course without title -> 400 on field 'title'", r.status === 400 && r.json?.error?.field === "title", r);

  r = await call("POST", `/courses/${courseId}/modules`, { token: instructor.access_token, body: { title: "Module 1" } });
  check("add module -> 201", r.status === 201, r);
  const moduleId = r.json?.id;
  r = await call("POST", `/modules/${moduleId}/lectures`, { token: instructor.access_token, body: { title: "Lecture 1", video_url: "https://example.com/video.mp4", duration_seconds: 300 } });
  check("add lecture -> 201", r.status === 201, r);
  const lectureId = r.json?.id;

  r = await call("PUT", `/courses/${courseId}`, { token: instructor.access_token, body: { price: 199 } });
  check("update course price -> 200 and other fields untouched", r.status === 200 && r.json?.price === 199 && r.json?.title === title, r);

  // --- pending courses are hidden until an admin approves ---
  r = await call("GET", `/courses?q=${encodeURIComponent(title)}`);
  check("pending course not in public catalog", r.status === 200 && r.json?.pagination?.total === 0, r);
  r = await call("GET", `/courses/${courseId}`);
  check("pending course detail hidden from anonymous -> 404", r.status === 404, r);
  r = await call("GET", `/courses/${courseId}`, { token: instructor.access_token });
  check("pending course visible to its owner -> 200", r.status === 200, r);
  r = await call("POST", `/courses/${courseId}/enroll`, { token: student.access_token });
  check("cannot enroll in a pending course -> 404", r.status === 404, r);

  const admin = await login("admin@lms.dev");
  r = await call("POST", `/courses/${courseId}/approve`, { token: instructor.access_token, body: { decision: "approved" } });
  check("instructor cannot approve -> 403", r.status === 403, r);
  r = await call("POST", `/courses/${courseId}/approve`, { token: admin.access_token, body: { decision: "approved" } });
  check("admin approves -> 200", r.status === 200 && r.json?.status === "approved", r);

  // --- catalog ---
  r = await call("GET", `/courses?q=${encodeURIComponent(title)}`);
  check("approved course appears in catalog search", r.status === 200 && r.json?.pagination?.total === 1, r);
  r = await call("GET", "/courses?difficulty=beginner&category=Testing");
  check("category + difficulty filters work", r.status === 200 && r.json?.data?.every((c: any) => c.difficulty === "beginner"), r);
  r = await call("GET", "/courses?limit=2&page=1");
  check("pagination returns at most `limit` rows with metadata", r.status === 200 && r.json?.data?.length <= 2 && r.json?.pagination?.limit === 2, r);
  r = await call("GET", "/courses?difficulty=");
  check("empty filter value is ignored, not an error", r.status === 200, r);

  // --- enrollment + content gating ---
  r = await call("GET", `/courses/${courseId}`);
  const anonLecture = r.json?.modules?.[0]?.lectures?.[0];
  check("anonymous sees course outline but NOT video_url", r.status === 200 && !!anonLecture && !("video_url" in anonLecture), r);

  r = await call("POST", `/courses/${courseId}/enroll`, { token: student.access_token });
  check("student enrolls -> 201", r.status === 201, r);
  r = await call("POST", `/courses/${courseId}/enroll`, { token: student.access_token });
  check("enrolling twice -> 409", r.status === 409, r);
  r = await call("POST", `/courses/${courseId}/enroll`, { token: instructor.access_token });
  check("instructor cannot enroll -> 403", r.status === 403, r);

  r = await call("GET", "/enrollments/me", { token: student.access_token });
  check("GET /enrollments/me lists the course with progress", r.status === 200 && r.json?.[0]?.course?.id === courseId && r.json?.[0]?.progress_percent === 0, r);

  r = await call("GET", `/courses/${courseId}`, { token: student.access_token });
  const enrolledLecture = r.json?.modules?.[0]?.lectures?.[0];
  check("enrolled student sees video_url", r.status === 200 && r.json?.is_enrolled === true && !!enrolledLecture?.video_url, r);

  r = await call("GET", "/instructor/courses", { token: instructor.access_token });
  check("instructor dashboard lists own courses with enrollment_count", r.status === 200 && r.json?.some((c: any) => c.id === courseId && c.enrollment_count === 1), r);

  await week2({ student, instructor, admin, courseId, moduleId, lectureId, studentEmail: email });
  await week3(instructor);
  await week4a(instructor, admin);
  await week4b(instructor);

  console.log(failures === 0 ? (week3Skipped ? "\nAll checks that ran passed. (Week 3 checks were skipped: the AI service isn't running.)" : "\nAll checks passed.") : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

// ---------------------------------------------------------------------------------------------
// Week 2: video, progress, notes, assignments, quizzes, certificates, badges, analytics
// ---------------------------------------------------------------------------------------------
async function upload(path: string, token: string, field: string, name: string, bytes: Uint8Array, extra: Record<string, string> = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  form.append(field, new Blob([bytes as BlobPart]), name);
  const res = await fetch(`${BASE}/api/v1${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: res.status, json };
}

// 12 bytes that look like the start of an MP4 file ("....ftypmp42") - enough to pass the header check.
const FAKE_MP4 = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32, ...Array.from({ length: 200 }, (_, i) => i % 256)]);

async function week2(c: { student: any; instructor: any; admin: any; courseId: string; moduleId: string; lectureId: string; studentEmail: string }) {
  console.log("\n--- Week 2 ---");
  const sT = c.student.access_token, iT = c.instructor.access_token;
  let r: { status: number; json: any };

  // --- video upload ---
  r = await upload(`/lectures/${c.lectureId}/video`, c.student.access_token, "video", "a.mp4", FAKE_MP4);
  check("student cannot upload a video -> 403", r.status === 403, r);
  r = await upload(`/lectures/${c.lectureId}/video`, iT, "video", "notes.txt", new TextEncoder().encode("hello"));
  check("video upload with wrong extension -> 400", r.status === 400 && r.json?.error?.code === "INVALID_FILE", r);
  r = await upload(`/lectures/${c.lectureId}/video`, iT, "video", "fake.mp4", new TextEncoder().encode("this is not a video at all"));
  check("renamed non-video file is rejected by header check -> 400", r.status === 400, r);
  r = await upload(`/lectures/${c.lectureId}/video`, iT, "video", "lecture.mp4", FAKE_MP4, { duration_seconds: "300" });
  check("instructor uploads video -> 200, has_video, duration saved", r.status === 200 && r.json?.has_video === true && r.json?.duration_seconds === 300, r);

  // --- learn outline + playback ---
  r = await call("GET", `/courses/${c.courseId}/learn`, { token: sT });
  check("learn outline for enrolled student", r.status === 200 && r.json?.modules?.[0]?.lectures?.[0]?.has_video === true && r.json?.enrollment?.progress_percent === 0, r);
  check("resume points at the first lecture", r.json?.resume_lecture_id === c.lectureId, r.json?.resume_lecture_id);

  const outsider = (await call("POST", "/auth/register", { body: { full_name: "Outsider", email: `outsider+${Date.now()}@example.com`, password: PASSWORD } })).json;
  r = await call("GET", `/courses/${c.courseId}/learn`, { token: outsider.access_token });
  check("learn outline for non-enrolled student -> 403", r.status === 403, r);
  r = await call("POST", `/lectures/${c.lectureId}/playback`, { token: outsider.access_token });
  check("playback link for non-enrolled student -> 403", r.status === 403, r);

  r = await call("POST", `/lectures/${c.lectureId}/playback`, { token: sT });
  check("playback link for enrolled student -> 200", r.status === 200 && typeof r.json?.url === "string", r);
  const mediaPath: string = r.json?.url ?? "";
  let res = await fetch(`${BASE}/api/v1${mediaPath}`, { headers: { Range: "bytes=0-9" } });
  check("video streams with HTTP Range -> 206 and 10 bytes", res.status === 206 && (await res.arrayBuffer()).byteLength === 10, res.status);
  res = await fetch(`${BASE}/api/v1${mediaPath}`);
  check("full video request -> 200 with video content-type", res.status === 200 && res.headers.get("content-type") === "video/mp4", res.status);
  res = await fetch(`${BASE}/api/v1/media/lectures/${c.lectureId}`);
  check("video link without token -> 401", res.status === 401, res.status);
  res = await fetch(`${BASE}/api/v1/media/lectures/${c.lectureId}?token=${sT}`);
  check("an ACCESS token can't be used as a video link -> 401", res.status === 401, res.status);

  // --- notes & bookmarks ---
  r = await call("POST", `/lectures/${c.lectureId}/notes`, { token: sT, body: { timestamp_seconds: 42, content: "Remember this" } });
  check("add note -> 201", r.status === 201, r);
  const noteId = r.json?.id;
  r = await call("POST", `/lectures/${c.lectureId}/notes`, { token: sT, body: { timestamp_seconds: 1, content: "  " } });
  check("empty note -> 400", r.status === 400, r);
  r = await call("GET", `/lectures/${c.lectureId}/notes`, { token: sT });
  check("list notes", r.status === 200 && r.json?.length === 1 && r.json[0].timestamp_seconds === 42, r);
  r = await call("DELETE", `/notes/${noteId}`, { token: outsider.access_token });
  check("someone else can't delete my note -> 404/403", r.status === 404 || r.status === 403, r);
  r = await call("POST", `/lectures/${c.lectureId}/bookmarks`, { token: sT, body: { timestamp_seconds: 90 } });
  check("add bookmark -> 201", r.status === 201, r);
  const bmId = r.json?.id;
  r = await call("GET", `/lectures/${c.lectureId}/bookmarks`, { token: sT });
  check("list bookmarks", r.status === 200 && r.json?.length === 1, r);
  r = await call("DELETE", `/bookmarks/${bmId}`, { token: sT });
  check("delete bookmark -> 204", r.status === 204, r);
  r = await call("DELETE", `/notes/${noteId}`, { token: sT });
  check("delete own note -> 204", r.status === 204, r);

  // --- assignments ---
  const future = new Date(Date.now() + 7 * 864e5).toISOString();
  r = await call("POST", "/assignments", { token: sT, body: { course_id: c.courseId, title: "Nope nope" } });
  check("student can't create assignment -> 403", r.status === 403, r);
  r = await call("POST", "/assignments", { token: iT, body: { course_id: c.courseId, title: "Essay", instructions: "Write it", due_date: future, max_points: 20, rubric: [{ criterion: "Clarity", points: 20 }] } });
  check("instructor creates assignment -> 201", r.status === 201 && r.json?.max_points === 20, r);
  const asgId = r.json?.id;
  r = await call("POST", "/assignments", { token: iT, body: { course_id: c.courseId, title: "Late one", due_date: new Date(Date.now() - 864e5).toISOString() } });
  const lateId = r.json?.id;

  r = await upload(`/assignments/${asgId}/submit`, outsider.access_token, "file", "a.txt", new TextEncoder().encode("x"));
  check("non-enrolled student can't submit -> 403", r.status === 403, r);
  r = await upload(`/assignments/${asgId}/submit`, sT, "file", "virus.exe", new TextEncoder().encode("x"));
  check("disallowed file type -> 400", r.status === 400 && r.json?.error?.code === "INVALID_FILE", r);
  r = await upload(`/assignments/${lateId}/submit`, sT, "file", "a.txt", new TextEncoder().encode("x"));
  check("submitting after the deadline -> 400 DEADLINE_PASSED", r.status === 400 && r.json?.error?.code === "DEADLINE_PASSED", r);
  r = await upload(`/assignments/${asgId}/submit`, sT, "file", "essay.txt", new TextEncoder().encode("first draft"));
  check("student submits -> 201", r.status === 201, r);
  r = await upload(`/assignments/${asgId}/submit`, sT, "file", "essay-v2.txt", new TextEncoder().encode("second draft"));
  check("resubmitting replaces the file -> 201", r.status === 201 && r.json?.original_name === "essay-v2.txt", r);

  r = await call("GET", `/courses/${c.courseId}/assignments`, { token: sT });
  const mine = r.json?.find((a: any) => a.id === asgId);
  check("student sees status 'submitted'", r.status === 200 && mine?.status === "submitted" && mine?.submission?.original_name === "essay-v2.txt", r);
  r = await call("GET", `/assignments/${asgId}/submissions`, { token: sT });
  check("student can't list all submissions -> 403", r.status === 403, r);
  r = await call("GET", `/assignments/${asgId}/submissions`, { token: iT });
  check("instructor lists exactly 1 submission", r.status === 200 && r.json?.length === 1, r);
  const subId = r.json?.[0]?.id;

  res = await fetch(`${BASE}/api/v1/submissions/${subId}/file`, { headers: { Authorization: `Bearer ${iT}` } });
  check("instructor downloads the submitted file (latest version)", res.status === 200 && (await res.text()) === "second draft", res.status);
  res = await fetch(`${BASE}/api/v1/submissions/${subId}/file`, { headers: { Authorization: `Bearer ${outsider.access_token}` } });
  check("another student can't download it -> 403", res.status === 403, res.status);

  r = await call("PUT", `/submissions/${subId}/grade`, { token: sT, body: { grade: 20 } });
  check("student can't grade -> 403", r.status === 403, r);
  r = await call("PUT", `/submissions/${subId}/grade`, { token: iT, body: { grade: 25 } });
  check("grade above max_points -> 400", r.status === 400, r);
  r = await call("PUT", `/submissions/${subId}/grade`, { token: iT, body: { grade: 18, feedback: "Nice work" } });
  check("instructor grades -> 200", r.status === 200 && r.json?.grade === 18, r);
  r = await call("GET", `/courses/${c.courseId}/assignments`, { token: sT });
  const graded = r.json?.find((a: any) => a.id === asgId);
  check("student sees grade + feedback", graded?.status === "graded" && graded?.submission?.grade === 18 && graded?.submission?.feedback === "Nice work", graded);
  r = await upload(`/assignments/${asgId}/submit`, sT, "file", "late-change.txt", new TextEncoder().encode("x"));
  check("can't resubmit after grading -> 409", r.status === 409, r);

  // --- quizzes ---
  const quizBody = (questions: any[]) => ({ module_id: c.moduleId, title: "Smoke quiz", questions });
  const goodQs = [
    { question_text: "Pick the right one", question_type: "mcq", points: 2, options: [{ option_text: "A", is_correct: false }, { option_text: "B", is_correct: true }] },
    { question_text: "Pick all primes", question_type: "multi_select", options: [{ option_text: "2", is_correct: true }, { option_text: "3", is_correct: true }, { option_text: "4", is_correct: false }] },
    { question_text: "Capital of France?", question_type: "short_answer", accepted_answers: ["Paris"] },
    { question_text: "Explain in your own words", question_type: "short_answer" },
  ];
  r = await call("POST", "/quizzes", { token: iT, body: quizBody([{ question_text: "Two right answers?", question_type: "mcq", options: [{ option_text: "A", is_correct: true }, { option_text: "B", is_correct: true }] }]) });
  check("mcq with two correct options -> 400", r.status === 400, r);
  r = await call("POST", "/quizzes", { token: sT, body: quizBody(goodQs) });
  check("student can't create a quiz -> 403", r.status === 403, r);
  r = await call("POST", "/quizzes", { token: iT, body: quizBody(goodQs) });
  check("instructor creates quiz -> 201 (unpublished)", r.status === 201 && r.json?.is_published === false && r.json?.question_count === 4, r);
  const quizId = r.json?.id;

  r = await call("POST", `/quizzes/${quizId}/attempt`, { token: sT });
  check("can't attempt an unpublished quiz -> 404", r.status === 404, r);
  r = await call("PUT", `/quizzes/${quizId}`, { token: iT, body: { is_published: true } });
  check("instructor publishes -> 200", r.status === 200 && r.json?.is_published === true, r);

  r = await call("GET", `/quizzes/${quizId}`, { token: sT });
  const raw = JSON.stringify(r.json);
  check("student's quiz view has NO answer key", r.status === 200 && !raw.includes("is_correct") && !raw.includes("accepted_answers") && !raw.includes("Paris"), raw.slice(0, 120));
  const qs = r.json?.questions ?? [];
  r = await call("GET", `/quizzes/${quizId}`, { token: iT });
  const full = r.json?.questions ?? [];
  check("owner's quiz view includes the answer key", full[0]?.options?.some((o: any) => o.is_correct === true), full[0]);

  r = await call("POST", `/quizzes/${quizId}/attempt`, { token: outsider.access_token });
  check("non-enrolled student can't attempt -> 403", r.status === 403, r);

  // attempt 1: everything wrong
  r = await call("POST", `/quizzes/${quizId}/attempt`, { token: sT });
  check("start attempt -> 201", r.status === 201 && !!r.json?.attempt_id, r);
  const a1 = r.json?.attempt_id;
  const wrong = [
    { question_id: qs[0].id, selected_option_ids: [qs[0].options[0].id] },
    { question_id: qs[1].id, selected_option_ids: [qs[1].options[2].id] },
    { question_id: qs[2].id, text_answer: "London" },
  ];
  r = await call("POST", `/attempts/${a1}/submit`, { token: sT, body: { answers: wrong } });
  check("all-wrong attempt scores 0 (one question left for manual review)", r.status === 200 && r.json?.score === 0 && r.json?.ungraded_count === 1, r);
  r = await call("POST", `/attempts/${a1}/submit`, { token: sT, body: { answers: wrong } });
  check("submitting the same attempt twice -> 409", r.status === 409, r);

  // attempt 2: all right (multi-select must be the exact set; short answer is case-insensitive)
  r = await call("POST", `/quizzes/${quizId}/attempt`, { token: sT });
  const a2 = r.json?.attempt_id;
  const right = [
    { question_id: qs[0].id, selected_option_ids: [full[0].options.find((o: any) => o.is_correct).id] },
    { question_id: qs[1].id, selected_option_ids: full[1].options.filter((o: any) => o.is_correct).map((o: any) => o.id) },
    { question_id: qs[2].id, text_answer: "  paris " },
    { question_id: qs[3].id, text_answer: "my explanation" },
  ];
  r = await call("POST", `/attempts/${a2}/submit`, { token: sT, body: { answers: right } });
  check("perfect attempt scores 100 and returns the answer key", r.status === 200 && r.json?.score === 100 && r.json?.results?.[0]?.correct_option_ids?.length === 1, r);
  check("perfect score awards the badge", r.json?.new_badges?.includes("Perfect score"), r.json?.new_badges);

  // partial multi-select is all-or-nothing
  r = await call("POST", `/quizzes/${quizId}/attempt`, { token: sT });
  const partial = [{ question_id: qs[1].id, selected_option_ids: [full[1].options.find((o: any) => o.is_correct).id] }];
  r = await call("POST", `/attempts/${r.json.attempt_id}/submit`, { token: sT, body: { answers: partial } });
  check("half of a multi-select earns nothing", r.json?.results?.find((x: any) => x.question_id === qs[1].id)?.correct === false, r.json?.results);

  r = await call("GET", `/courses/${c.courseId}/quizzes`, { token: sT });
  const listed = r.json?.find((q: any) => q.id === quizId);
  check("quiz list shows best score and attempts for the student", listed?.best_score === 100 && listed?.attempts === 3, listed);

  // --- finishing the course: certificate, badges, streak ---
  r = await call("POST", `/lectures/${c.lectureId}/progress`, { token: sT, body: { position_seconds: 120 } });
  check("progress saves the position, not complete yet", r.status === 200 && r.json?.completed === false && r.json?.progress_percent === 0, r);
  r = await call("POST", `/lectures/${c.lectureId}/progress`, { token: iT, body: { position_seconds: 1 } });
  check("instructor can't record progress -> 403", r.status === 403, r);
  r = await call("GET", `/courses/${c.courseId}/learn`, { token: sT });
  check("learn outline remembers the resume position", r.json?.modules?.[0]?.lectures?.[0]?.position_seconds === 120, r.json?.modules?.[0]?.lectures?.[0]);
  r = await call("POST", `/lectures/${c.lectureId}/progress`, { token: sT, body: { position_seconds: 290 } });
  check("watching past 90% completes the lecture -> course at 100%", r.status === 200 && r.json?.completed === true && r.json?.progress_percent === 100, r);
  check("completing the course issues a certificate and the first-course badge", !!r.json?.certificate?.id && r.json?.new_badges?.includes("First course completed"), r.json);
  const certId = r.json?.certificate?.id;
  r = await call("POST", `/lectures/${c.lectureId}/progress`, { token: sT, body: { position_seconds: 295 } });
  check("progress again doesn't issue a second certificate", r.status === 200 && r.json?.new_badges?.length === 0, r.json);

  r = await call("GET", "/certificates/me", { token: sT });
  check("certificate is listed", r.status === 200 && r.json?.length === 1 && r.json[0].id === certId, r);
  const code = r.json?.[0]?.code;
  res = await fetch(`${BASE}/api/v1/certificates/${certId}/download`, { headers: { Authorization: `Bearer ${sT}` } });
  const pdfBytes = new Uint8Array(await res.arrayBuffer());
  check("certificate downloads as a real PDF", res.status === 200 && new TextDecoder().decode(pdfBytes.slice(0, 5)) === "%PDF-" && pdfBytes.length > 1000, [res.status, pdfBytes.length]);
  res = await fetch(`${BASE}/api/v1/certificates/${certId}/download`, { headers: { Authorization: `Bearer ${outsider.access_token}` } });
  check("someone else can't download my certificate -> 404", res.status === 404, res.status);
  r = await call("GET", `/certificates/verify/${code}`);
  check("anyone can verify a certificate code", r.status === 200 && r.json?.valid === true && r.json?.student_name === "Smoke Test", r);
  r = await call("GET", "/certificates/verify/NOTAREALCODE");
  check("a fake code is reported invalid", r.status === 200 && r.json?.valid === false, r);

  r = await call("GET", "/users/me/badges", { token: sT });
  const earned = (r.json ?? []).filter((b: any) => b.earned_at).map((b: any) => b.code).sort();
  check("badges list: first_course + quiz_perfect earned, streak_7 still locked", JSON.stringify(earned) === JSON.stringify(["first_course", "quiz_perfect"]) && r.json.length === 3, earned);
  r = await call("GET", "/users/me/streak", { token: sT });
  check("streak is 1 day after learning today", r.status === 200 && r.json?.current_streak === 1 && r.json?.active_today === true, r);
  r = await call("GET", "/users/me/streak", { token: outsider.access_token });
  check("a brand-new student has a zero streak", r.json?.current_streak === 0, r);

  // --- analytics ---
  r = await call("GET", `/instructor/courses/${c.courseId}/analytics`, { token: sT });
  check("student can't read analytics -> 403", r.status === 403, r);
  r = await call("GET", `/instructor/courses/${c.courseId}/analytics`, { token: iT });
  const lec = r.json?.lectures?.[0];
  check("analytics: enrollment + completion numbers", r.status === 200 && r.json?.enrolled === 1 && r.json?.completed === 1 && r.json?.avg_progress === 100, r.json);
  check("analytics: per-lecture drop-off", lec?.started === 1 && lec?.completed === 1, lec);
  check("analytics: quiz + assignment stats", r.json?.quizzes?.[0]?.students === 1 && r.json?.quizzes?.[0]?.attempts === 3 && r.json?.assignments?.[0]?.graded === 1 && r.json?.assignments?.[0]?.avg_grade_percent === 90, [r.json?.quizzes, r.json?.assignments]);
  check("analytics: watched time is counted", (r.json?.total_watched_seconds ?? 0) >= 290, r.json?.total_watched_seconds);

  // --- cleanup paths ---
  r = await call("DELETE", `/quizzes/${quizId}`, { token: iT });
  check("instructor deletes quiz -> 204", r.status === 204, r);
  r = await call("DELETE", `/assignments/${asgId}`, { token: iT });
  check("instructor deletes assignment (and its files) -> 204", r.status === 204, r);
  r = await call("DELETE", `/lectures/${c.lectureId}`, { token: sT });
  check("student can't delete a lecture -> 403", r.status === 403, r);
  r = await call("DELETE", `/lectures/${c.lectureId}`, { token: iT });
  check("instructor deletes lecture -> 204", r.status === 204, r);
  res = await fetch(`${BASE}/api/v1${mediaPath}`);
  check("deleted lecture's video link stops working", res.status === 404 || res.status === 401, res.status);
}

// ---------------------------------------------------------------------------------------------
// Week 3: AI tutor. Needs the Python service (default http://localhost:8000). Works with demo OR real providers,
// so the checks test behaviour (grounding, permissions, shapes), not exact wording.
// ---------------------------------------------------------------------------------------------
const AI_URL = process.env.AI_URL ?? "http://localhost:8000";
let week3Skipped = false;

async function ai(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
  const res = await fetch(`${AI_URL}/api/v1/ai${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: res.status, json };
}

async function week3(instructor: any) {
  console.log("\n--- Week 3 (AI tutor) ---");
  try { await fetch(`${AI_URL}/health`); } catch { console.log(`SKIP  AI service not reachable at ${AI_URL}. Start it, then run this again.`); week3Skipped = true; return; }

  const iT = instructor.access_token;
  let r: { status: number; json: any };
  const status = (await ai("GET", "/status")).json;
  check("AI status is public and reports the providers", typeof status?.llm_provider === "string" && typeof status?.demo === "boolean", status);
  const demo = !!status?.demo;
  console.log(`      (${demo ? "DEMO mode: checking pipeline + permissions" : "REAL providers"}: llm=${status?.llm_provider}, embeddings=${status?.embedding_provider})`);

  // fresh student + the seeded SQL course
  const stu = (await call("POST", "/auth/register", { body: { full_name: "Tutor Test", email: `tutor+${Date.now()}@example.com`, password: PASSWORD } })).json;
  const sT = stu.access_token;
  const outsider = (await call("POST", "/auth/register", { body: { full_name: "Outsider Two", email: `out2+${Date.now()}@example.com`, password: PASSWORD } })).json;
  const sqlId = (await call("GET", "/courses?q=SQL%20for")).json?.data?.[0]?.id;
  check("seeded 'SQL for Beginners' course exists", !!sqlId, sqlId);
  await call("POST", `/courses/${sqlId}/enroll`, { token: sT });
  const detail = (await call("GET", `/courses/${sqlId}`, { token: iT })).json;
  const module1 = detail.modules[0];

  // ---- instructor: transcripts + indexing ----
  for (const m of detail.modules) for (const l of m.lectures) {
    if (l.has_transcript) await ai("POST", `/lectures/${l.id}/index`, { token: iT });
  }
  r = await ai("GET", `/courses/${sqlId}/status`, { token: sT });
  check("course status: enrolled student sees indexed lectures", r.status === 200 && r.json?.ready === true && r.json.lectures.every((l: any) => l.indexed), r.json);
  r = await ai("GET", `/courses/${sqlId}/status`, { token: outsider.access_token });
  check("course status: non-enrolled -> 403", r.status === 403, r);

  r = await call("POST", `/modules/${module1.id}/lectures`, { token: iT, body: { title: "Zephyr protocol (test)" } });
  const zLecture = r.json?.id;
  r = await ai("POST", `/lectures/${zLecture}/index`, { token: iT });
  check("indexing a lecture with no transcript -> 422", r.status === 422 && r.json?.error?.code === "NO_TRANSCRIPT", r);
  const zephyr = "The Zephyr protocol opens every connection with a three step handshake called ping, pong and acknowledge.\n\nAfter the acknowledge step the Zephyr client may send its first frame. A frame larger than four kilobytes is always rejected by the server.";
  r = await call("PUT", `/lectures/${zLecture}/transcript`, { token: iT, body: { transcript: zephyr } });
  check("instructor saves a transcript (not yet indexed)", r.status === 200 && r.json?.has_transcript === true && r.json?.ai_indexed === false, r);
  r = await call("PUT", `/lectures/${zLecture}/transcript`, { token: sT, body: { transcript: "hacked" } });
  check("student can't edit transcripts -> 403", r.status === 403, r);
  r = await ai("POST", `/lectures/${zLecture}/index`, { token: sT });
  check("student can't index -> 403", r.status === 403, r);
  r = await ai("POST", `/lectures/${zLecture}/index`, { token: iT });
  check("instructor indexes it -> passages created", r.status === 200 && r.json?.chunks >= 1, r);
  r = await call("GET", `/lectures/${zLecture}/transcript`, { token: iT });
  check("transcript status now says indexed", r.json?.ai_indexed === true && r.json?.indexed_chunks >= 1 && r.json?.transcript === zephyr, r.json);

  // ---- chat: sessions, grounding, citations, history ----
  r = await ai("POST", "/chat/sessions", { body: { course_id: sqlId } });
  check("chat without login -> 401", r.status === 401, r);
  r = await ai("POST", "/chat/sessions", { token: outsider.access_token, body: { course_id: sqlId } });
  check("chat for non-enrolled student -> 403", r.status === 403, r);
  r = await ai("POST", "/chat/sessions", { token: sT, body: { course_id: sqlId, mode: "wizard" } });
  check("invalid mode -> 400", r.status === 400 && r.json?.error?.code === "VALIDATION_ERROR", r);
  r = await ai("POST", "/chat/sessions", { token: sT, body: { course_id: sqlId } });
  check("student starts a chat session (auto mode)", r.status === 201 && r.json?.mode === "auto", r);
  const sid = r.json?.id;

  r = await ai("POST", `/chat/sessions/${sid}/messages`, { token: sT, body: { message: "What are the three steps of the Zephyr handshake?" } });
  check("tutor answers", r.status === 200 && typeof r.json?.reply === "string" && r.json.reply.length > 10, r);
  const zSource = r.json?.sources?.find((x: any) => x.lecture_id === zLecture);
  check("answer cites the lecture we just added, with a snippet", !!zSource && typeof zSource.snippet === "string", r.json?.sources);

  r = await ai("POST", `/chat/sessions/${sid}/messages`, { token: sT, body: { message: "What is the difference between INNER JOIN and LEFT JOIN?" } });
  check("join question is answered from the JOIN lectures", r.status === 200 && r.json?.sources?.some((x: any) => /JOIN/.test(x.lecture_title)), r.json?.sources);
  check("each source has lecture_id, title, and a timestamp field", r.json?.sources?.every((x: any) => x.lecture_id && x.lecture_title && "timestamp_seconds" in x), r.json?.sources);

  if (demo) {
    r = await ai("POST", `/chat/sessions/${sid}/messages`, { token: sT, body: { message: "Who won the cricket world cup in 2011?" } });
    check("off-topic question is refused, with no sources", r.status === 200 && r.json?.sources?.length === 0 && /couldn't find/i.test(r.json?.reply), r.json);
  } else {
    console.log("      (skipping the off-topic refusal check: wording depends on the real model)");
  }
  r = await ai("POST", `/chat/sessions/${sid}/messages`, { token: sT, body: { message: "   " } });
  check("blank message -> 400", r.status === 400, r);
  r = await ai("POST", `/chat/sessions/${sid}/messages`, { token: outsider.access_token, body: { message: "hello there" } });
  check("someone else's session -> 404", r.status === 404, r);

  r = await ai("GET", `/chat/sessions/${sid}/messages`, { token: sT });
  const roles = (r.json ?? []).map((m: any) => m.sender).join(",");
  check("history is stored in order (user, ai, user, ai...)", r.status === 200 && /^(user,ai,?)+$/.test(roles) && r.json.length >= 4, roles);
  r = await ai("GET", `/chat/sessions/${sid}/messages`, { token: outsider.access_token });
  check("can't read someone else's history -> 404", r.status === 404, r);
  r = await ai("GET", `/chat/sessions?course_id=${sqlId}`, { token: sT });
  check("session list shows my session with its message count", r.status === 200 && r.json?.[0]?.id === sid && r.json[0].message_count >= 4, r);
  r = await ai("PUT", `/chat/sessions/${sid}/mode`, { token: sT, body: { mode: "advanced" } });
  check("switch explanation mode", r.status === 200 && r.json?.mode === "advanced", r);
  r = await ai("POST", `/chat/sessions/${sid}/messages`, { token: sT, body: { message: "How does WHERE filter rows?" } });
  check("explicit mode is used as the level", r.status === 200 && r.json?.level === "advanced", r.json?.level);

  // clearing a transcript makes the AI forget it
  await call("PUT", `/lectures/${zLecture}/transcript`, { token: iT, body: { transcript: "" } });
  r = await ai("POST", `/chat/sessions/${sid}/messages`, { token: sT, body: { message: "What are the three steps of the Zephyr handshake?" } });
  check("after the transcript is cleared, the tutor no longer cites it", !(r.json?.sources ?? []).some((x: any) => x.lecture_id === zLecture), r.json?.sources);

  // ---- summaries ----
  const joinLecture = detail.modules.flatMap((m: any) => m.lectures).find((l: any) => l.title === "INNER JOIN");
  r = await ai("POST", `/lectures/${joinLecture.id}/summarize`, { token: outsider.access_token, body: {} });
  check("summary for non-enrolled -> 403", r.status === 403, r);
  r = await ai("POST", `/lectures/${zLecture}/summarize`, { token: sT, body: {} });
  check("summary of a lecture with no transcript -> 422", r.status === 422 && r.json?.error?.code === "NO_TRANSCRIPT", r);
  r = await ai("POST", `/lectures/${joinLecture.id}/summarize`, { token: sT, body: { level: "beginner" } });
  check("summary has text and key points", r.status === 200 && r.json?.summary?.length > 10 && r.json?.key_points?.length >= 1, r);
  r = await ai("POST", `/lectures/${joinLecture.id}/summarize`, { token: sT, body: { level: "beginner" } });
  check("asking again is served from the cache (no second AI call)", r.status === 200 && r.json?.cached === true, r.json?.cached);

  // ---- AI quiz draft -> the normal quiz API ----
  r = await ai("POST", `/lectures/${joinLecture.id}/generate-quiz`, { token: sT, body: {} });
  check("student can't generate quizzes -> 403", r.status === 403, r);
  r = await ai("POST", `/lectures/${joinLecture.id}/generate-quiz`, { token: iT, body: { num_questions: 4, difficulty: "easy" } });
  const draft = r.json;
  check("instructor gets a quiz draft", r.status === 200 && draft?.questions?.length >= 1 && draft.questions.length <= 4 && draft?.is_ai_generated === true, r);
  check("draft is shaped for the quiz API and each mcq has exactly one correct option", draft?.questions?.every((q: any) => q.question_type !== "mcq" || q.options.filter((o: any) => o.is_correct).length === 1), draft?.questions);
  r = await ai("POST", `/lectures/${joinLecture.id}/generate-quiz`, { token: iT, body: { num_questions: 99 } });
  check("asking for 99 questions -> 400", r.status === 400, r);
  r = await call("POST", "/quizzes", { token: iT, body: { module_id: draft.module_id, title: draft.title, questions: draft.questions, is_ai_generated: true, generated_from_lecture_id: draft.generated_from_lecture_id } });
  check("the draft passes the normal quiz validation and saves unpublished", r.status === 201 && r.json?.is_published === false && r.json?.is_ai_generated === true, r);
  const draftQuizId = r.json?.id;
  r = await call("GET", `/courses/${sqlId}/quizzes`, { token: iT });
  check("quiz list flags AI-generated quizzes", r.json?.find((q: any) => q.id === draftQuizId)?.is_ai_generated === true, r.json);
  r = await call("GET", `/courses/${sqlId}/quizzes`, { token: sT });
  check("students don't see the unpublished AI draft", !r.json?.some((q: any) => q.id === draftQuizId), r.json);

  // ---- flashcards ----
  r = await ai("POST", `/modules/${module1.id}/flashcards`, { token: outsider.access_token, body: {} });
  check("flashcards for non-enrolled -> 403", r.status === 403, r);
  r = await ai("POST", `/modules/${module1.id}/flashcards`, { token: sT, body: { count: 6 } });
  check("student gets flashcards", r.status === 200 && r.json?.cards?.length >= 1 && r.json.cards.every((c: any) => c.question && c.answer), r);
  const firstIds = (r.json?.cards ?? []).map((c: any) => c.id).join();
  r = await ai("POST", `/modules/${module1.id}/flashcards`, { token: sT, body: {} });
  check("second request reuses the same cards (shared per module)", r.json?.generated === false && r.json.cards.map((c: any) => c.id).join() === firstIds, r.json?.generated);
  r = await ai("POST", `/modules/${module1.id}/flashcards`, { token: sT, body: { regenerate: true } });
  check("students can't regenerate -> 403", r.status === 403, r);
  r = await ai("POST", `/modules/${module1.id}/flashcards`, { token: iT, body: { regenerate: true, count: 5 } });
  check("instructor can regenerate", r.status === 200 && r.json?.generated === true, r);
  r = await ai("GET", `/modules/${module1.id}/flashcards`, { token: sT });
  check("list flashcards", r.status === 200 && r.json?.cards?.length >= 1, r);

  // ---- mastery: quiz results feed it; auto mode adapts ----
  const quizzes = (await call("GET", `/courses/${sqlId}/quizzes`, { token: sT })).json;
  const quizId = quizzes.find((q: any) => q.title === "Querying basics check").id;
  const view = (await call("GET", `/quizzes/${quizId}`, { token: sT })).json;
  const key = (await call("GET", `/quizzes/${quizId}`, { token: iT })).json;
  const answer = (right: boolean) => view.questions.map((q: any, i: number) => {
    const full = key.questions[i];
    if (q.question_type === "short_answer") return { question_id: q.id, text_answer: right ? full.accepted_answers[0] : "no idea" };
    const correct = full.options.filter((o: any) => o.is_correct).map((o: any) => o.id);
    const wrong = full.options.filter((o: any) => !o.is_correct).map((o: any) => o.id);
    return { question_id: q.id, selected_option_ids: right ? correct : wrong.slice(0, 1) };
  });
  r = await call("GET", `/courses/${sqlId}/mastery`, { token: sT });
  check("mastery starts empty (null score)", r.status === 200 && r.json?.[0]?.score === null && r.json[0].evidence_count === 0, r.json);
  let attempt = (await call("POST", `/quizzes/${quizId}/attempt`, { token: sT })).json.attempt_id;
  r = await call("POST", `/attempts/${attempt}/submit`, { token: sT, body: { answers: answer(false) } });
  check("a failed quiz scores 0", r.json?.score === 0, r.json?.score);
  r = await call("GET", `/courses/${sqlId}/mastery`, { token: sT });
  check("mastery after the first attempt = that score", r.json?.[0]?.score === 0 && r.json[0].evidence_count === 1, r.json?.[0]);
  attempt = (await call("POST", `/quizzes/${quizId}/attempt`, { token: sT })).json.attempt_id;
  await call("POST", `/attempts/${attempt}/submit`, { token: sT, body: { answers: answer(true) } });
  r = await call("GET", `/courses/${sqlId}/mastery`, { token: sT });
  check("mastery is a moving average (60% history + 40% new = 40)", r.json?.[0]?.score === 40 && r.json[0].evidence_count === 2, r.json?.[0]);
  r = await call("GET", `/courses/${sqlId}/mastery`, { token: outsider.access_token });
  check("mastery for non-enrolled -> 403", r.status === 403, r);

  r = await ai("POST", "/chat/sessions", { token: sT, body: { course_id: sqlId, mode: "auto" } });
  const autoSid = r.json?.id;
  r = await ai("POST", `/chat/sessions/${autoSid}/messages`, { token: sT, body: { message: "How do ORDER BY and LIMIT work together to return the top rows?" } });
  check("auto mode adapts: weak topic (40%) -> beginner-level explanation", r.status === 200 && r.json?.level === "beginner", r.json?.level);

  // ---- study plan ----
  r = await ai("POST", "/study-plan", { token: outsider.access_token, body: { course_id: sqlId } });
  check("study plan for non-enrolled -> 403", r.status === 403, r);
  r = await ai("GET", `/study-plan?course_id=${sqlId}`, { token: sT });
  check("no plan yet -> plan: null", r.status === 200 && r.json?.plan === null, r);
  r = await ai("POST", "/study-plan", { token: sT, body: { course_id: sqlId } });
  const moduleIds = detail.modules.map((m: any) => m.id);
  check("study plan has steps with minutes", r.status === 200 && r.json?.plan?.steps?.length >= 1 && r.json.plan.steps.every((s: any) => s.estimated_minutes >= 5), r);
  check("plan steps only reference real modules", r.json?.plan?.steps?.every((s: any) => s.module_id === null || moduleIds.includes(s.module_id)), r.json?.plan?.steps);
  check("plan targets the weak module", r.json?.plan?.steps?.some((s: any) => s.module_id === module1.id), r.json?.plan?.steps);
  r = await ai("GET", `/study-plan?course_id=${sqlId}`, { token: sT });
  check("the saved plan can be fetched again", r.status === 200 && r.json?.plan?.steps?.length >= 1, r);

  // ---- recommendations ----
  r = await call("GET", "/recommendations/me", { token: sT });
  check("recommendations: a list that excludes courses I'm enrolled in", r.status === 200 && Array.isArray(r.json) && r.json.length >= 1 && !r.json.some((c: any) => c.id === sqlId), r.json?.map?.((c: any) => c.title));
  check("each recommendation has a score and a human-readable reason", r.json?.every((c: any) => typeof c.score === "number" && typeof c.reason === "string" && c.reason.length > 5), r.json?.[0]);
  check("recommendations are sorted best-first", r.json?.every((c: any, i: number, a: any[]) => i === 0 || a[i - 1].score >= c.score), r.json?.map?.((c: any) => c.score));
  r = await call("GET", "/recommendations/me", { token: outsider.access_token });
  check("a brand-new student also gets suggestions", r.status === 200 && r.json?.length >= 1, r);
  r = await call("GET", "/recommendations/me", { token: iT });
  check("recommendations are for students -> 403 for instructors", r.status === 403, r);

  // tidy up what this run created
  await call("DELETE", `/lectures/${zLecture}`, { token: iT });
  await call("DELETE", `/quizzes/${draftQuizId}`, { token: iT });
}

// ---------------------------------------------------------------------------------------------
// Week 4a: admin panel, notifications, reviews + rating filter, lecture materials, thumbnails
// ---------------------------------------------------------------------------------------------
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array.from({ length: 64 }, (_, i) => i)]);

async function week4a(instructor: any, admin: any) {
  console.log("\n--- Week 4a (admin, notifications, reviews, materials, thumbnails) ---");
  const iT = instructor.access_token, aT = (await login("admin@lms.dev")).access_token;
  let r: { status: number; json: any };
  const fresh = async (label: string) => {
    const email = `${label}+${Date.now()}${Math.floor(Math.random() * 1e4)}@example.com`;
    const res = (await call("POST", "/auth/register", { body: { full_name: `${label} Person`, email, password: PASSWORD } })).json;
    return { email, id: res.user.id as string, token: res.access_token as string, refresh: res.refresh_token as string };
  };
  const u1 = await fresh("rolecheck"), u2 = await fresh("suspendme"), u3 = await fresh("deleteme"), u4 = await fresh("reviewer"), nobody = await fresh("nobody");

  // ---- who may use /admin at all ----
  r = await call("GET", "/admin/users");
  check("admin API without login -> 401", r.status === 401, r);
  r = await call("GET", "/admin/users", { token: u1.token });
  check("a student can't use the admin API -> 403", r.status === 403, r);
  r = await call("GET", "/admin/users", { token: iT });
  check("an instructor can't use the admin API -> 403", r.status === 403, r);

  // ---- users: search, filter ----
  r = await call("GET", `/admin/users?q=${encodeURIComponent(u1.email)}`, { token: aT });
  check("search users by email", r.status === 200 && r.json?.data?.length === 1 && r.json.data[0].id === u1.id && r.json.data[0].roles.join() === "student", r);
  r = await call("GET", "/admin/users?role=admin&limit=50", { token: aT });
  check("filter users by role", r.status === 200 && r.json?.data?.length >= 1 && r.json.data.every((u: any) => u.roles.includes("admin")), r.json?.data?.map?.((u: any) => u.roles));
  r = await call("GET", "/admin/users?role=wizard", { token: aT });
  check("unknown role filter -> 400", r.status === 400, r);

  // ---- roles ----
  r = await call("PUT", `/admin/users/${u1.id}/role`, { token: aT, body: { roles: [] } });
  check("a user must keep at least one role -> 400", r.status === 400, r);
  r = await call("PUT", `/admin/users/${u1.id}/role`, { token: aT, body: { roles: ["superhero"] } });
  check("invalid role -> 400", r.status === 400, r);
  r = await call("PUT", `/admin/users/${u1.id}/role`, { token: aT, body: { roles: ["student", "instructor"] } });
  check("admin gives a user the instructor role", r.status === 200 && r.json?.roles?.join() === "student,instructor", r);
  const u1Login = await login(u1.email);
  check("after signing in again the user has the new role", u1Login.user?.roles?.includes("instructor") && u1Login.user?.role === "instructor", u1Login.user);
  r = await call("PUT", `/admin/users/${u1.id}/role`, { token: u1Login.access_token, body: { roles: ["admin"] } });
  check("a non-admin can't change roles -> 403", r.status === 403, r);
  r = await call("PUT", `/admin/users/${u1.id}/role`, { token: aT, body: { roles: ["student", "admin"] } });
  const u1AsAdmin = await login(u1.email);
  r = await call("PUT", `/admin/users/${u1.id}/role`, { token: u1AsAdmin.access_token, body: { roles: ["student"] } });
  check("an admin can't remove their own admin role -> 400", r.status === 400, r);
  r = await call("PUT", `/admin/users/${u1.id}/role`, { token: aT, body: { roles: ["student", "instructor"] } });
  check("another admin can take admin away again", r.status === 200, r);
  r = await call("GET", "/notifications", { token: u1.token });
  check("the user was told about the role change", r.json?.data?.some((n: any) => n.type === "account"), r.json?.data);

  // ---- suspend / reactivate ----
  r = await call("PUT", `/admin/users/${u2.id}/suspend`, { token: aT, body: { suspended: true, reason: "spam" } });
  check("admin suspends a user", r.status === 200 && r.json?.is_active === false, r);
  r = await call("POST", "/auth/login", { body: { email: u2.email, password: PASSWORD } });
  check("a suspended user can't sign in -> 403", r.status === 403, r);
  r = await call("POST", "/auth/refresh", { body: { refresh_token: u2.refresh } });
  check("their existing session can't renew itself -> 401", r.status === 401, r);
  r = await call("GET", "/admin/users?status=suspended&limit=100", { token: aT });
  check("the suspended list contains them", r.json?.data?.some((u: any) => u.id === u2.id && u.is_active === false), r.json?.pagination);
  r = await call("PUT", `/admin/users/${u2.id}/suspend`, { token: aT, body: { suspended: false } });
  check("admin reactivates them", r.status === 200 && r.json?.is_active === true, r);
  r = await call("POST", "/auth/login", { body: { email: u2.email, password: PASSWORD } });
  check("and they can sign in again", r.status === 200, r.status);
  const adminId = (await call("GET", "/auth/me", { token: aT })).json.id;
  r = await call("PUT", `/admin/users/${adminId}/suspend`, { token: aT, body: { suspended: true } });
  check("admins can't suspend themselves -> 400", r.status === 400, r);

  // ---- delete ----
  const sqlId = (await call("GET", "/courses?q=SQL%20for")).json?.data?.[0]?.id;
  await call("POST", `/courses/${sqlId}/enroll`, { token: u3.token });
  r = await call("DELETE", `/admin/users/${u3.id}?confirm_email=wrong@example.com`, { token: aT });
  check("deleting needs the exact email as confirmation -> 400", r.status === 400, r);
  r = await call("DELETE", `/admin/users/${u3.id}?confirm_email=${encodeURIComponent(u3.email)}`, { token: u3.token });
  check("a student can't delete users -> 403", r.status === 403, r);
  r = await call("DELETE", `/admin/users/${adminId}?confirm_email=admin@lms.dev`, { token: aT });
  check("admins can't delete themselves -> 400", r.status === 400, r);
  r = await call("DELETE", `/admin/users/${(await call("GET", "/auth/me", { token: iT })).json.id}?confirm_email=instructor@lms.dev`, { token: aT });
  check("an instructor who owns courses can't be deleted -> 409", r.status === 409, r);
  r = await call("DELETE", `/admin/users/${u3.id}?confirm_email=${encodeURIComponent(u3.email.toUpperCase())}`, { token: aT });
  check("admin deletes a student (with enrolments)", r.status === 204, r);
  r = await call("GET", `/admin/users?q=${encodeURIComponent(u3.email)}`, { token: aT });
  check("the deleted user is gone", r.json?.data?.length === 0, r.json);
  r = await call("POST", "/auth/login", { body: { email: u3.email, password: PASSWORD } });
  check("and can't sign in", r.status === 401, r.status);

  // ---- audit trail ----
  r = await call("GET", "/admin/audit-logs?action=user.", { token: aT });
  const actions = new Set((r.json?.data ?? []).map((a: any) => a.action));
  check("the audit log recorded roles, suspension and deletion", ["user.roles_changed", "user.suspended", "user.reactivated", "user.deleted"].every((a) => actions.has(a)), [...actions]);
  const deletion = r.json?.data?.find((a: any) => a.action === "user.deleted" && a.metadata?.email === u3.email);
  check("audit entries say who did it and keep the details", deletion?.actor_name === "Meera Admin" && deletion?.metadata?.name === "deleteme Person", deletion);
  r = await call("GET", "/admin/audit-logs", { token: iT });
  check("instructors can't read the audit log -> 403", r.status === 403, r);

  // ---- approval queue + notifications ----
  const title = `Week4 queue test ${Date.now()}`;
  const course = (await call("POST", "/courses", { token: iT, body: { title, description: "Queue test", category: "Testing", difficulty: "beginner", price: 99 } })).json;
  const mod = (await call("POST", `/courses/${course.id}/modules`, { token: iT, body: { title: "M1" } })).json;
  await call("POST", `/modules/${mod.id}/lectures`, { token: iT, body: { title: "L1", video_url: "https://example.com/v.mp4" } });
  r = await call("GET", `/admin/courses/pending?q=${encodeURIComponent(title)}`, { token: aT });
  const queued = r.json?.data?.[0];
  check("a new course appears in the approval queue with its details", r.status === 200 && queued?.id === course.id && queued.module_count === 1 && queued.lecture_count === 1 && queued.video_count === 1 && queued.instructor_name === "Rohit Instructor", r.json);
  r = await call("GET", "/admin/courses/pending", { token: u4.token });
  check("students can't see the queue -> 403", r.status === 403, r);
  r = await call("GET", "/admin/courses?status=nonsense", { token: aT });
  check("unknown status filter -> 400", r.status === 400, r);

  r = await call("POST", `/courses/${course.id}/approve`, { token: aT, body: { decision: "rejected", comment: "Please add a description of what students will build." } });
  check("admin rejects with a comment", r.status === 200 && r.json?.status === "rejected", r);
  r = await call("GET", "/notifications", { token: iT });
  const rejected = r.json?.data?.find((n: any) => n.type === "course_review" && n.title.includes(title));
  check("the instructor is notified, with the reason and a link", !!rejected && rejected.body.includes("add a description") && rejected.link === `/teach/courses/${course.id}` && rejected.is_read === false, rejected);
  r = await call("GET", "/notifications/unread-count", { token: iT });
  const unreadBefore = r.json?.unread;
  check("unread count includes it", unreadBefore >= 1, r.json);
  r = await call("PUT", `/notifications/${rejected.id}/read`, { token: u4.token });
  check("you can't mark someone else's notification -> 404", r.status === 404, r);
  r = await call("PUT", `/notifications/${rejected.id}/read`, { token: iT });
  check("mark one as read", r.status === 200 && r.json?.is_read === true, r);
  r = await call("GET", "/notifications/unread-count", { token: iT });
  check("unread count dropped by one", r.json?.unread === unreadBefore - 1, r.json);
  r = await call("GET", "/notifications?unread=true&limit=5", { token: iT });
  check("filter to unread only", r.status === 200 && r.json?.data?.every((n: any) => n.is_read === false), r.json?.data?.length);

  r = await call("POST", `/courses/${course.id}/approve`, { token: aT, body: { decision: "approved" } });
  check("admin approves after the fix", r.status === 200 && r.json?.status === "approved", r);
  r = await call("GET", "/notifications?unread=true", { token: iT });
  check("approval notification arrives", r.json?.data?.some((n: any) => n.title.includes("is now published") && n.title.includes(title)), r.json?.data?.map?.((n: any) => n.title));
  r = await call("PUT", "/notifications/read-all", { token: iT });
  check("mark all read", r.status === 200, r);
  r = await call("GET", "/notifications/unread-count", { token: iT });
  check("nothing unread afterwards", r.json?.unread === 0, r.json);
  r = await call("GET", "/admin/audit-logs?action=course.", { token: aT });
  check("course decisions are in the audit log", r.json?.data?.some((a: any) => a.action === "course.approved" && a.metadata?.title === title), r.json?.data?.[0]);

  // ---- platform analytics ----
  r = await call("GET", "/admin/analytics/overview", { token: aT });
  const o = r.json;
  check("analytics: headline numbers", r.status === 200 && o?.users_total >= 6 && o?.enrollments_total >= 1 && o?.completion_rate >= 0 && o?.completion_rate <= 100 && typeof o?.estimated_revenue === "number", o && { users: o.users_total, enrol: o.enrollments_total });
  check("analytics: 14 daily points, oldest first, no gaps", o?.enrollments_per_day?.length === 14 && o.enrollments_per_day.every((d: any, i: number, a: any[]) => i === 0 || d.day > a[i - 1].day), o?.enrollments_per_day?.map?.((d: any) => d.day));
  check("analytics: courses by status and users by role", o?.courses_by_status?.approved >= 3 && o?.users_by_role?.student >= 5 && o?.users_by_role?.admin >= 1, [o?.courses_by_status, o?.users_by_role]);
  check("analytics: top courses sorted by enrolments", o?.top_courses?.length >= 1 && o.top_courses.every((c: any, i: number, a: any[]) => i === 0 || a[i - 1].enrollments >= c.enrollments), o?.top_courses?.map?.((c: any) => c.enrollments));
  check("analytics: someone was active today (seeded + this run)", o?.active_today >= 1 && o?.active_7d >= o?.active_today, [o?.active_today, o?.active_7d]);
  r = await call("GET", "/admin/analytics/overview", { token: iT });
  check("analytics are admin-only -> 403", r.status === 403, r);

  // ---- reviews + rating filter ----
  await call("POST", `/courses/${sqlId}/enroll`, { token: u4.token });
  r = await call("PUT", `/courses/${sqlId}/reviews`, { token: nobody.token, body: { rating: 5 } });
  check("only enrolled students can review -> 403", r.status === 403, r);
  r = await call("PUT", `/courses/${sqlId}/reviews`, { token: iT, body: { rating: 5 } });
  check("instructors can't review -> 403", r.status === 403, r);
  for (const bad of [0, 6, 3.5]) {
    r = await call("PUT", `/courses/${sqlId}/reviews`, { token: u4.token, body: { rating: bad } });
    check(`rating ${bad} is rejected -> 400`, r.status === 400, r);
  }
  const before = (await call("GET", `/courses/${sqlId}/reviews`)).json.summary.count;
  r = await call("PUT", `/courses/${sqlId}/reviews`, { token: u4.token, body: { rating: 5, comment: "Great course" } });
  check("an enrolled student leaves a review", r.status === 200 && r.json?.rating === 5, r);
  r = await call("PUT", `/courses/${sqlId}/reviews`, { token: u4.token, body: { rating: 4, comment: "Great course, fewer typos please" } });
  r = await call("GET", `/courses/${sqlId}/reviews`, { token: u4.token });
  check("reviewing again updates it (still one review)", r.json?.summary?.count === before + 1 && r.json.items[0].mine === true && r.json.items[0].rating === 4, r.json?.summary);
  check("reviews show a short author name and the summary adds up", /^\w+ \w\.$/.test(r.json?.items?.[0]?.author_name) && Object.values(r.json.summary.distribution).reduce((a: any, b: any) => a + b, 0) === r.json.summary.count && r.json.can_review === true, r.json?.items?.[0]);
  r = await call("GET", `/courses/${sqlId}/reviews`);
  check("anyone can read reviews, and can_review is false for them", r.status === 200 && r.json?.can_review === false && r.json.items.every((i: any) => i.mine === false), r.json?.can_review);

  r = await call("GET", "/courses?min_rating=4&limit=50");
  check("catalog: rating filter keeps well-rated courses and shows the numbers", r.json?.data?.some((c: any) => c.id === sqlId && c.rating_avg >= 4 && c.rating_count >= 4) && r.json.data.every((c: any) => c.rating_avg >= 4), r.json?.data?.map?.((c: any) => [c.title, c.rating_avg]));
  r = await call("GET", "/courses?min_rating=5&limit=50");
  check("catalog: a stricter filter drops courses averaging below 5", !r.json?.data?.some((c: any) => c.id === sqlId), r.json?.data?.length);
  r = await call("GET", "/courses?min_rating=9");
  check("catalog: min_rating above 5 -> 400", r.status === 400, r);
  r = await call("GET", "/courses?min_rating=");
  check("catalog: empty rating filter is ignored", r.status === 200, r);
  r = await call("GET", `/courses/${sqlId}`);
  check("course page includes the rating", r.json?.rating_count >= 4 && r.json.rating_avg > 0, [r.json?.rating_avg, r.json?.rating_count]);

  const mine = (await call("GET", `/courses/${sqlId}/reviews`, { token: u4.token })).json.items.find((i: any) => i.mine);
  r = await call("DELETE", `/reviews/${mine.id}`, { token: nobody.token });
  check("you can't delete someone else's review -> 403", r.status === 403, r);
  r = await call("DELETE", `/reviews/${mine.id}`, { token: u4.token });
  check("you can delete your own review", r.status === 204, r);
  await call("PUT", `/courses/${sqlId}/reviews`, { token: u4.token, body: { rating: 1, comment: "spammy" } });
  const spam = (await call("GET", `/courses/${sqlId}/reviews`, { token: u4.token })).json.items.find((i: any) => i.mine);
  r = await call("DELETE", `/reviews/${spam.id}`, { token: aT });
  check("an admin can remove any review", r.status === 204, r);
  r = await call("GET", "/admin/audit-logs?action=review.", { token: aT });
  check("and it's audited", r.json?.data?.some((a: any) => a.action === "review.removed"), r.json?.data?.[0]);

  // ---- lecture materials ----
  const detail = (await call("GET", `/courses/${sqlId}`, { token: iT })).json;
  const lecture = detail.modules[0].lectures[0].id;
  const pdf = new TextEncoder().encode("%PDF-1.4 fake slides for the smoke test");
  r = await upload(`/lectures/${lecture}/resources`, u4.token, "file", "slides.pdf", pdf);
  check("a student can't upload materials -> 403", r.status === 403, r);
  r = await upload(`/lectures/${lecture}/resources`, iT, "file", "malware.exe", pdf);
  check("materials: disallowed file type -> 400", r.status === 400 && r.json?.error?.code === "INVALID_FILE", r);
  r = await upload(`/lectures/${lecture}/resources`, iT, "file", "slides.pdf", pdf);
  check("instructor uploads a PDF", r.status === 201 && r.json?.original_name === "slides.pdf" && r.json.file_size === pdf.length, r);
  const resId = r.json?.id;
  r = await call("GET", `/lectures/${lecture}/resources`, { token: nobody.token });
  check("non-enrolled student can't list materials -> 403", r.status === 403, r);
  await call("POST", `/courses/${sqlId}/enroll`, { token: nobody.token });
  r = await call("GET", `/lectures/${lecture}/resources`, { token: nobody.token });
  check("an enrolled student sees them", r.status === 200 && r.json?.length === 1 && r.json[0].original_name === "slides.pdf", r);
  let res = await fetch(`${BASE}/api/v1/resources/${resId}/file`, { headers: { Authorization: `Bearer ${nobody.token}` } });
  check("and downloads the exact file, as an attachment", res.status === 200 && (await res.text()) === "%PDF-1.4 fake slides for the smoke test" && /attachment/.test(res.headers.get("content-disposition") ?? ""), res.status);
  res = await fetch(`${BASE}/api/v1/resources/${resId}/file`, { headers: { Authorization: `Bearer ${u1.token}` } });
  check("a student who isn't enrolled can't download -> 403", res.status === 403, res.status);
  r = await call("DELETE", `/resources/${resId}`, { token: nobody.token });
  check("students can't delete materials -> 403", r.status === 403, r);
  r = await call("DELETE", `/resources/${resId}`, { token: iT });
  check("instructor deletes the material", r.status === 204, r);
  r = await call("GET", `/lectures/${lecture}/resources`, { token: iT });
  check("and the list is empty again", r.json?.length === 0, r.json);

  // ---- thumbnails ----
  r = await upload(`/courses/${course.id}/thumbnail`, u4.token, "image", "pic.png", PNG);
  check("a student can't set a thumbnail -> 403", r.status === 403, r);
  r = await upload(`/courses/${course.id}/thumbnail`, u1Login.access_token, "image", "pic.png", PNG);
  check("another instructor can't touch my course -> 403", r.status === 403, r);
  r = await upload(`/courses/${course.id}/thumbnail`, iT, "image", "pic.svg", new TextEncoder().encode("<svg onload=alert(1)/>"));
  check("SVG is refused (it can carry scripts) -> 400", r.status === 400 && r.json?.error?.code === "INVALID_FILE", r);
  r = await upload(`/courses/${course.id}/thumbnail`, iT, "image", "fake.png", new TextEncoder().encode("this is not an image"));
  check("a text file renamed .png is caught by the header check -> 400", r.status === 400, r);
  r = await upload(`/courses/${course.id}/thumbnail`, iT, "image", "pic.png", PNG);
  check("instructor uploads a real PNG", r.status === 200 && /\/api\/v1\/courses\/.+\/thumbnail\?v=\d+/.test(r.json?.thumbnail_url), r);
  res = await fetch(`${BASE}/api/v1/courses/${course.id}/thumbnail`);
  const got = new Uint8Array(await res.arrayBuffer());
  check("the thumbnail is public and served as an image", res.status === 200 && res.headers.get("content-type") === "image/png" && got.length === PNG.length, [res.status, res.headers.get("content-type")]);
  r = await call("GET", `/courses?q=${encodeURIComponent(title)}`);
  check("the catalog points at it", r.json?.data?.[0]?.thumbnail_url?.includes("/thumbnail"), r.json?.data?.[0]?.thumbnail_url);
  res = await fetch(`${BASE}/api/v1/courses/${sqlId}/thumbnail`);
  check("a course without an uploaded thumbnail -> 404", res.status === 404, res.status);

  // keep the catalog tidy: this run's test course goes back to "rejected"
  await call("POST", `/courses/${course.id}/approve`, { token: aT, body: { decision: "rejected", comment: "test cleanup" } });
}

// ---------------------------------------------------------------------------------------------
// Week 4b: discussions, announcements, moderation, leaderboard, email preferences, caching
// ---------------------------------------------------------------------------------------------
async function week4b(instructor: any) {
  console.log("\n--- Week 4b (forum, announcements, moderation, leaderboard, email preferences, cache) ---");
  const iT = instructor.access_token, aT = (await login("admin@lms.dev")).access_token;
  let r: { status: number; json: any };
  const fresh = async (label: string) => {
    const email = `${label}+${Date.now()}${Math.floor(Math.random() * 1e4)}@example.com`;
    const res = (await call("POST", "/auth/register", { body: { full_name: `${label} Person`, email, password: PASSWORD } })).json;
    return { email, id: res.user.id as string, token: res.access_token as string };
  };
  const [alice, bob, outsider] = [await fresh("alice"), await fresh("bob"), await fresh("outsider")];

  // a course that is approved and has two students
  const title = `Community Test ${Date.now()}`;
  r = await call("POST", "/courses", { token: iT, body: { title, category: "Testing", difficulty: "beginner" } });
  const courseId = r.json.id as string;
  await call("POST", `/courses/${courseId}/approve`, { token: aT, body: { decision: "approved" } });
  await call("POST", `/courses/${courseId}/enroll`, { token: alice.token });
  await call("POST", `/courses/${courseId}/enroll`, { token: bob.token });

  // ---- who may enter the community ----
  r = await call("GET", `/courses/${courseId}/threads`);
  check("forum needs login -> 401", r.status === 401, r);
  r = await call("GET", `/courses/${courseId}/threads`, { token: outsider.token });
  check("a student who isn't enrolled can't read the forum -> 403", r.status === 403, r);
  r = await call("POST", `/courses/${courseId}/threads`, { token: outsider.token, body: { title: "Hello there", content: "hi" } });
  check("...or post in it -> 403", r.status === 403, r);

  // ---- threads and replies ----
  r = await call("POST", `/courses/${courseId}/threads`, { token: alice.token, body: { title: "x", content: "" } });
  check("empty/short thread is rejected -> 400", r.status === 400, r);
  r = await call("POST", `/courses/${courseId}/threads`, { token: alice.token, body: { title: "What is a primary key?", content: "I keep mixing it up with a foreign key." } });
  const threadId = r.json?.id as string;
  check("enrolled student starts a thread -> 201", r.status === 201 && !!threadId, r);

  r = await call("GET", "/notifications?unread=true", { token: iT });
  check("the instructor was notified of the new discussion", r.json?.data?.some((n: any) => n.type === "discussion" && n.body === "What is a primary key?"), r.json?.data?.slice?.(0, 2));

  r = await call("POST", `/threads/${threadId}/posts`, { token: bob.token, body: { content: "A primary key identifies a row; a foreign key points at another table's row." } });
  const bobPost = r.json?.id as string;
  check("another student replies -> 201", r.status === 201 && !!bobPost, r);
  r = await call("POST", `/threads/${threadId}/posts`, { token: iT, body: { content: "Nice answer, Bob.", parent_id: bobPost } });
  const instrPost = r.json?.id as string;
  check("the instructor replies to that reply (nested) -> 201", r.status === 201, r);
  r = await call("POST", `/threads/${threadId}/posts`, { token: alice.token, body: { content: "orphan", parent_id: "00000000-0000-4000-8000-000000000000" } });
  check("replying to a post that isn't in the thread -> 400", r.status === 400, r);

  r = await call("GET", "/notifications?unread=true", { token: alice.token });
  check("the thread's author was notified of the replies", r.json?.data?.filter((n: any) => n.type === "discussion").length >= 2, r.json?.data?.length);

  r = await call("GET", `/threads/${threadId}`, { token: alice.token });
  const posts = r.json?.posts ?? [];
  check("thread detail returns every post with parent links", r.status === 200 && posts.length === 3 && posts.find((p: any) => p.id === instrPost)?.parent_id === bobPost, posts);
  check("names are shortened and the instructor is marked", posts[0]?.author_name === "alice P." && posts.find((p: any) => p.id === instrPost)?.by_instructor === true, posts.map((p: any) => [p.author_name, p.by_instructor]));
  check("students are told which posts are theirs but not who reported what", posts[0]?.mine === true && posts.every((p: any) => p.report_count === 0 && p.is_flagged === false), posts[0]);

  r = await call("GET", `/courses/${courseId}/threads?q=primary`, { token: bob.token });
  check("thread list is searchable and counts replies", r.status === 200 && r.json?.data?.[0]?.reply_count === 2, r.json);

  // ---- pinning ----
  r = await call("PUT", `/threads/${threadId}/pin`, { token: alice.token, body: { pinned: true } });
  check("a student can't pin -> 403", r.status === 403, r);
  r = await call("PUT", `/threads/${threadId}/pin`, { token: iT, body: { pinned: true } });
  check("the instructor pins it", r.status === 200 && r.json?.is_pinned === true, r);

  // ---- reports and moderation ----
  r = await call("POST", `/posts/${bobPost}/report`, { token: bob.token, body: {} });
  check("you can't report your own post -> 400", r.status === 400, r);
  r = await call("POST", `/posts/${bobPost}/report`, { token: alice.token, body: { reason: "Spam test" } });
  check("a student reports a post -> 201", r.status === 201, r);
  r = await call("POST", `/posts/${bobPost}/report`, { token: alice.token, body: { reason: "again" } });
  check("reporting twice is harmless", r.status === 201, r);
  r = await call("GET", `/threads/${threadId}`, { token: iT });
  const flagged = r.json?.posts?.find((p: any) => p.id === bobPost);
  check("the instructor sees the flag and one report", r.json?.can_moderate === true && flagged?.is_flagged === true && flagged?.report_count === 1, flagged);
  r = await call("GET", `/threads/${threadId}`, { token: bob.token });
  check("...but the author doesn't", r.json?.posts?.find((p: any) => p.id === bobPost)?.is_flagged === false, r.json?.posts?.find((p: any) => p.id === bobPost));

  r = await call("GET", "/admin/moderation/flagged-posts", { token: alice.token });
  check("the moderation queue is admin-only -> 403", r.status === 403, r);
  r = await call("GET", "/admin/moderation/flagged-posts", { token: aT });
  const entry = r.json?.data?.find((p: any) => p.id === bobPost);
  check("admin sees the reported post with its reason", r.status === 200 && entry?.report_count === 1 && entry?.reasons?.includes("Spam test") && entry?.course_title === title, entry);

  r = await call("PUT", `/posts/${bobPost}/dismiss-reports`, { token: alice.token });
  check("a student can't dismiss reports -> 403", r.status === 403, r);
  r = await call("PUT", `/posts/${bobPost}/dismiss-reports`, { token: iT });
  check("the instructor dismisses the report", r.status === 200 && r.json?.is_flagged === false, r);
  r = await call("GET", "/admin/moderation/flagged-posts", { token: aT });
  check("it leaves the queue", !r.json?.data?.some((p: any) => p.id === bobPost), r.json?.data?.length);

  // ---- deleting ----
  r = await call("DELETE", `/posts/${instrPost}`, { token: alice.token });
  check("a student can't delete someone else's post -> 403", r.status === 403, r);
  r = await call("DELETE", `/posts/${bobPost}`, { token: iT });
  check("the instructor removes a student's post (and the reply under it)", r.status === 200 && r.json?.thread_deleted === false, r);
  r = await call("GET", `/threads/${threadId}`, { token: alice.token });
  check("both are gone, the opening post remains", r.json?.posts?.length === 1, r.json?.posts?.length);
  r = await call("GET", "/admin/audit-logs?action=post.", { token: aT });
  check("the removal is in the audit log", r.json?.data?.some((a: any) => a.action === "post.removed" && a.metadata?.course_id === courseId), r.json?.data?.slice?.(0, 2));

  // ---- announcements ----
  r = await call("POST", `/courses/${courseId}/announcements`, { token: alice.token, body: { title: "Free pizza", content: "Everyone gets pizza" } });
  check("a student can't post an announcement -> 403", r.status === 403, r);
  r = await call("POST", `/courses/${courseId}/announcements`, { token: iT, body: { title: "ab", content: "" } });
  check("an empty announcement is rejected -> 400", r.status === 400, r);
  r = await call("POST", `/courses/${courseId}/announcements`, { token: iT, body: { title: "Exam moved", content: "The exam is now on Friday." } });
  const annId = r.json?.id as string;
  check("the instructor posts an announcement and 2 students are notified", r.status === 201 && r.json?.notified === 2, r);
  r = await call("GET", "/notifications?unread=true", { token: bob.token });
  check("a student gets it as a notification", r.json?.data?.some((n: any) => n.type === "announcement" && n.title.endsWith("Exam moved")), r.json?.data?.slice?.(0, 2));
  r = await call("GET", `/courses/${courseId}/announcements`, { token: alice.token });
  check("enrolled students can read announcements", r.status === 200 && r.json?.data?.[0]?.id === annId && r.json?.can_post === false, r);
  r = await call("GET", `/courses/${courseId}/announcements`, { token: outsider.token });
  check("outsiders can't -> 403", r.status === 403, r);

  // ---- email: preference + queue ----
  r = await call("GET", "/notifications/preferences", { token: bob.token });
  check("email notifications are on by default", r.status === 200 && r.json?.email_notifications === true, r);
  r = await call("PUT", "/notifications/preferences", { token: bob.token, body: { email_notifications: false } });
  check("a student can switch emails off", r.status === 200 && r.json?.email_notifications === false, r);
  r = await call("PUT", "/notifications/preferences", { token: bob.token, body: { email_notifications: "nope" } });
  check("a bad preference value -> 400", r.status === 400, r);
  const health = await (await fetch(`${BASE}/health`)).json();
  check("/health reports the email queue", typeof health.email_queue === "object", health);

  // ---- leaderboard ----
  r = await call("GET", `/leaderboard/${courseId}`, { token: outsider.token });
  check("leaderboard is for course members only -> 403", r.status === 403, r);
  r = await call("GET", `/leaderboard/${courseId}`, { token: alice.token });
  check("leaderboard ranks enrolled students, hides ids, marks me", r.status === 200 && r.json?.participants === 2 && r.json.top.length === 2 && r.json.top.filter((x: any) => x.mine).length === 1 && r.json.top.every((x: any) => !("user_id" in x)), r.json);
  const mineForBob = (await call("GET", `/leaderboard/${courseId}`, { token: bob.token })).json?.top?.find((x: any) => x.mine)?.name;
  check("the cached list is personalised per viewer (Bob sees himself, not Alice)", mineForBob === "bob P.", mineForBob);

  // ---- catalog cache ----
  const q = `/courses?q=${encodeURIComponent(title)}`;
  r = await call("GET", q);
  check("catalog serves the new course", r.json?.pagination?.total === 1, r);
  await call("PUT", `/courses/${courseId}`, { token: iT, body: { title: title + " (renamed)" } });
  r = await call("GET", q);
  check("editing a course clears the catalog cache (rename visible at once)", r.json?.data?.[0]?.title === title + " (renamed)", r.json?.data?.[0]?.title);
  await call("POST", `/courses/${courseId}/approve`, { token: aT, body: { decision: "rejected", comment: "test cleanup" } });
  r = await call("GET", q);
  check("rejecting it removes it from the cached catalog at once", r.json?.pagination?.total === 0, r.json?.pagination);

  // ---- security headers ----
  const h = await fetch(`${BASE}/api/v1/courses`);
  check("responses carry security headers and a request id", h.headers.get("x-content-type-options") === "nosniff" && h.headers.get("x-frame-options") === "DENY" && !!h.headers.get("x-request-id") && !h.headers.get("x-powered-by"), [...h.headers.keys()]);
}

/** Run with the rate limiter ON: RATE_LIMIT_CHECK=1 pnpm smoke */
async function rateLimitCheck() {
  console.log("--- rate limit check (server must be running with RATE_LIMIT_ENABLED=true) ---");
  let last = { status: 0, json: null as any };
  let firstBlocked = 0;
  for (let i = 1; i <= 12; i++) {
    last = await call("POST", "/auth/login", { body: { email: "nobody@example.com", password: "wrong-password" } });
    if (last.status === 429 && !firstBlocked) firstBlocked = i;
  }
  check("the 11th login attempt within a minute is blocked with 429", firstBlocked === 11, firstBlocked);
  check("the block uses the standard error format", last.json?.error?.code === "RATE_LIMITED", last);
  const res = await fetch(`${BASE}/api/v1/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  check("a Retry-After header says when to try again", Number(res.headers.get("retry-after")) > 0, res.headers.get("retry-after"));
  const health = await fetch(`${BASE}/health`);
  check("/health is never rate limited", health.status === 200, health.status);
  console.log(failures === 0 ? "\nRate limit check passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Smoke test crashed:", err);
  process.exit(1);
});
