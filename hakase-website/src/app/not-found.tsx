import Link from "next/link";
import { ArrowRight } from "lucide-react";

export default function NotFound() {
  return (
    <div className="container-x flex min-h-[70vh] flex-col items-start justify-center pt-32">
      <div className="accent">404</div>
      <h1 className="h1 mt-5">Page not found.</h1>
      <p className="lede mt-5 max-w-lg">
        The link may be outdated or the page has moved. Head back home and try again.
      </p>
      <Link href="/" className="btn-primary mt-8">
        Go home <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}
