import { z } from "zod";

export const knowledgeEntrySchema = z.object({
  category: z.enum(["faq", "company", "services", "pricing", "policies", "hours", "hotel", "other"], {
    error: "Choose a category",
  }),
  title: z.string().trim().min(1, "Enter a title").max(200, "Keep the title under 200 characters"),
  content: z.string().trim().min(1, "Enter the content").max(20000, "Keep the content under 20,000 characters"),
});

export type KnowledgeEntryInput = z.output<typeof knowledgeEntrySchema>;

export function knowledgeFromFormData(fd: FormData) {
  const s = (k: string) => (typeof fd.get(k) === "string" ? (fd.get(k) as string) : "");
  return { category: s("category"), title: s("title"), content: s("content") };
}
