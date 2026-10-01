"use client";
import { AlertCircle } from "lucide-react";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <main className="page-loading"><AlertCircle size={32} /><h1>Unable to load this page</h1><p>Please check your connection and try again.</p><button className="button button-primary" onClick={reset}>Try again</button></main>;
}
