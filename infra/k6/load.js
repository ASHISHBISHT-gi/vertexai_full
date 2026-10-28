// Basic load test (PRD 12, day 27): 100 concurrent users, p95 of non-AI endpoints under 300 ms.
//   Install k6 (https://k6.io), start the API with RATE_LIMIT_ENABLED=false (otherwise you are testing the limiter), then:
//   k6 run infra/k6/load.js                       (add -e BASE=https://your-site to test staging)
import http from "k6/http";
import { check, sleep } from "k6";

const BASE = __ENV.BASE || "http://localhost:4000";

export const options = {
  stages: [
    { duration: "20s", target: 100 }, // ramp up to 100 users
    { duration: "40s", target: 100 }, // hold
    { duration: "10s", target: 0 },
  ],
  thresholds: {
    http_req_duration: ["p(95)<300"], // PRD success metric
    http_req_failed: ["rate<0.01"],
  },
};

export function setup() {
  const res = http.post(`${BASE}/api/v1/auth/login`, JSON.stringify({ email: "student@lms.dev", password: "Password123!" }), { headers: { "Content-Type": "application/json" } });
  return { token: res.json("access_token") };
}

export default function (data) {
  const auth = { headers: { Authorization: `Bearer ${data.token}` } };
  const catalog = http.get(`${BASE}/api/v1/courses?limit=12`);
  check(catalog, { "catalog 200": (r) => r.status === 200 });
  const first = catalog.json("data.0.id");
  if (first) check(http.get(`${BASE}/api/v1/courses/${first}`), { "course 200": (r) => r.status === 200 });
  check(http.get(`${BASE}/api/v1/enrollments/me`, auth), { "enrollments 200": (r) => r.status === 200 });
  check(http.get(`${BASE}/api/v1/notifications/unread-count`, auth), { "unread 200": (r) => r.status === 200 });
  sleep(1);
}
