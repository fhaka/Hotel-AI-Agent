import type { Database } from "@/lib/supabase/database.types";

export type KnowledgeCategory = Database["public"]["Enums"]["knowledge_category"];

export const KNOWLEDGE_CATEGORIES: {
  value: KnowledgeCategory;
  label: string;
  titleLabel: string;
  contentLabel: string;
  hint: string;
}[] = [
  { value: "faq", label: "FAQ", titleLabel: "Question", contentLabel: "Answer", hint: "A question customers ask, with your answer." },
  { value: "company", label: "About the business", titleLabel: "Topic", contentLabel: "Details", hint: "History, team, what makes you different." },
  { value: "services", label: "Services & products", titleLabel: "Service", contentLabel: "Description", hint: "What you offer and how it works." },
  { value: "pricing", label: "Prices", titleLabel: "Item", contentLabel: "Price details", hint: "Only prices you want agents to quote exactly. Room prices come from your rooms." },
  { value: "policies", label: "Policies", titleLabel: "Policy", contentLabel: "Details", hint: "Rules customers need to know." },
  { value: "hours", label: "Hours", titleLabel: "What", contentLabel: "When", hint: "Hours for specific facilities, e.g. spa or restaurant." },
  { value: "hotel", label: "Hotel information", titleLabel: "Topic", contentLabel: "Details", hint: "Facilities, directions, local tips." },
  { value: "other", label: "Other", titleLabel: "Title", contentLabel: "Content", hint: "Anything else." },
];

export function categoryInfo(category: string) {
  return KNOWLEDGE_CATEGORIES.find((c) => c.value === category) ?? KNOWLEDGE_CATEGORIES[KNOWLEDGE_CATEGORIES.length - 1];
}

export function isKnowledgeCategory(value: unknown): value is KnowledgeCategory {
  return typeof value === "string" && KNOWLEDGE_CATEGORIES.some((c) => c.value === value);
}
