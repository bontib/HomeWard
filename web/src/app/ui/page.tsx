import { notFound } from "next/navigation";
import { UiGallery } from "@/features/ui-gallery/UiGallery";

export const metadata = { title: "UI parts" };

// Developer page that shows every UI part. Not available in production.
export default function UiPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <UiGallery />;
}
