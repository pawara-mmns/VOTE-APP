import type { Metadata } from "next";
import { ResultsPage } from "@/components/ResultsPage";
export const metadata: Metadata = { title: "Live results" };
export default function Results() { return <ResultsPage />; }
