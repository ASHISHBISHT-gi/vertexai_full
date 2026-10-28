import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { Button, buttonClass } from "../../components/common/Button";
import { ErrorMessage, Loading } from "../../components/common/Feedback";
import { StatusChip } from "../../components/common/StatusChip";
import { NewCourseForm } from "../../components/instructor/NewCourseForm";
import { coursesApi } from "../../services/lms";

export default function InstructorCoursesPage() {
  const { data, error, isPending } = useQuery({ queryKey: ["instructor-courses"], queryFn: coursesApi.mine });
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState("");

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold">Your courses</h1>
        {!showForm && <Button onClick={() => { setShowForm(true); setNotice(""); }}>New course</Button>}
      </div>

      {notice && (
        <p role="status" className="mt-4 rounded-md border border-ok/30 bg-ok/5 px-3 py-2 text-sm text-ok">
          {notice}
        </p>
      )}

      {showForm && (
        <div className="mt-6">
          <NewCourseForm
            onCreated={() => {
              setShowForm(false);
              setNotice("Course submitted. It stays hidden from students until an admin publishes it.");
            }}
          />
          <Button variant="quiet" className="mt-3" onClick={() => setShowForm(false)}>
            Cancel
          </Button>
        </div>
      )}

      {isPending && <Loading label="Loading your courses" />}
      <ErrorMessage error={error} />

      {data && data.length === 0 && !showForm && <p className="mt-8 text-muted">You haven't created a course yet.</p>}

      {data && data.length > 0 && (
        <ul className="mt-8 divide-y divide-line rounded-md border border-line bg-white">
          {data.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 p-5">
              <div>
                <Link to={`/courses/${c.id}`} className="text-lg font-medium hover:text-pen hover:underline">
                  {c.title}
                </Link>
                <p className="mt-0.5 text-sm text-muted">
                  {c.enrollment_count} {c.enrollment_count === 1 ? "student" : "students"} enrolled
                </p>
              </div>
              <div className="flex items-center gap-4">
                <StatusChip status={c.status} />
                <Link to={`/teach/courses/${c.id}`} className={buttonClass("secondary")}>
                  Manage
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
