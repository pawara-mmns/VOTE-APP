import type { Metadata } from "next";
import { isAdmin } from "@/lib/auth/admin";
import { AdminDashboard, AdminLogin } from "@/components/Admin";
export const metadata: Metadata = { title: "Event controls" };
export const dynamic = "force-dynamic";
export default async function Admin() { return await isAdmin() ? <AdminDashboard /> : <AdminLogin />; }
