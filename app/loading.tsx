import { LoaderCircle } from "lucide-react";
export default function Loading() {
  return <main className="page-loading" role="status"><LoaderCircle className="spin" size={28} /><span>Getting things ready…</span></main>;
}
