import type { Metadata } from "next";
import { LinkLandingPage } from "@/features/notifications/LinkLandingPage";

export const metadata: Metadata = { title: "Turn on email alerts" };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { token } = await searchParams;
  return <LinkLandingPage purpose="confirm" token={typeof token === "string" ? token : null} />;
}
