import { Link } from "react-router";
import { PageMessage } from "../components/common/Feedback";

export default function NotFoundPage() {
  return (
    <PageMessage title="Page not found">
      That address doesn't lead anywhere. <Link to="/courses" className="text-pen hover:underline">See all courses</Link>
    </PageMessage>
  );
}
