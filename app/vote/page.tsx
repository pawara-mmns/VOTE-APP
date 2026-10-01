import type { Metadata } from "next";
import { VotingPage } from "@/components/VotingPage";
export const metadata: Metadata = { title: "Cast your vote" };
export default function Vote() { return <VotingPage />; }
