import { Dashboard } from "@/components/dashboard";

const views = ["home", "reviews", "storage", "lab"] as const;

export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view } = await searchParams;
  const match = views.find((candidate) => candidate === view);
  return <Dashboard initialView={match || "home"} />;
}
