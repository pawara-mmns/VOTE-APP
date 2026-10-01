import Link from "next/link";
export default function NotFound() {
  return <main className="page-loading"><span className="eyebrow">404</span><h1>Page not found</h1><Link className="button button-primary" href="/">Back to the event</Link></main>;
}
