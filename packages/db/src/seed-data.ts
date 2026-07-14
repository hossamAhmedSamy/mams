/**
 * Idempotent domain seed (PLAN.md §2.3): skills, stages + qualifying skills,
 * workflow templates, expense categories. Used by the deploy seed script and
 * by the API test suite.
 */
import { eq } from "drizzle-orm";
import type { Db } from "./index";
import {
  expenseCategories,
  skills,
  stages,
  stageSkills,
  templateStages,
  workflowTemplates,
} from "./schema/index";

const SKILLS = [
  "Videographer",
  "Photographer",
  "Editor",
  "Designer",
  "Copywriter",
  "Creative",
  "Account Manager",
] as const;

const STAGES: {
  name: string;
  skills: string[];
  days: number;
  reminderRule: "none" | "end_of_last_day";
}[] = [
  { name: "Concept / Script", skills: ["Creative", "Copywriter"], days: 2, reminderRule: "none" },
  { name: "Content Copy", skills: ["Copywriter"], days: 2, reminderRule: "none" },
  { name: "Shooting", skills: ["Videographer", "Photographer"], days: 2, reminderRule: "end_of_last_day" },
  { name: "Editing", skills: ["Editor"], days: 3, reminderRule: "none" },
  { name: "Retouching", skills: ["Editor"], days: 2, reminderRule: "none" },
  { name: "Design", skills: ["Designer"], days: 3, reminderRule: "none" },
  { name: "Delivery", skills: ["Account Manager"], days: 1, reminderRule: "none" },
];

const TEMPLATES: { name: string; chain: string[] }[] = [
  { name: "Reels / Video", chain: ["Concept / Script", "Shooting", "Editing", "Delivery"] },
  { name: "Photo", chain: ["Concept / Script", "Shooting", "Retouching", "Delivery"] },
  { name: "Design", chain: ["Content Copy", "Design", "Delivery"] },
];

const EXPENSE_CATEGORIES = [
  "Equipment rental",
  "Transport",
  "Talent",
  "Location",
  "Freelancer fees",
  "Props",
  "Other",
];

export async function seedDomain(db: Db) {
  await db
    .insert(skills)
    .values(SKILLS.map((name) => ({ name })))
    .onConflictDoNothing();

  const skillRows = await db.select().from(skills);
  const skillId = (name: string) => {
    const row = skillRows.find((s) => s.name === name);
    if (!row) throw new Error(`seed: missing skill ${name}`);
    return row.id;
  };

  for (const [i, s] of STAGES.entries()) {
    await db
      .insert(stages)
      .values({
        name: s.name,
        defaultDurationDays: s.days,
        reminderRule: s.reminderRule,
        sortOrder: i,
      })
      .onConflictDoNothing();
    const [stageRow] = await db.select().from(stages).where(eq(stages.name, s.name));
    if (!stageRow) throw new Error(`seed: stage ${s.name} not found after insert`);
    await db
      .insert(stageSkills)
      .values(s.skills.map((sk) => ({ stageId: stageRow.id, skillId: skillId(sk) })))
      .onConflictDoNothing();
  }

  const stageRows = await db.select().from(stages);
  const stageIdByName = (name: string) => {
    const row = stageRows.find((s) => s.name === name);
    if (!row) throw new Error(`seed: missing stage ${name}`);
    return row.id;
  };

  for (const t of TEMPLATES) {
    await db.insert(workflowTemplates).values({ name: t.name }).onConflictDoNothing();
    const [tpl] = await db
      .select()
      .from(workflowTemplates)
      .where(eq(workflowTemplates.name, t.name));
    if (!tpl) throw new Error(`seed: template ${t.name} not found after insert`);
    for (const [i, stageName] of t.chain.entries()) {
      await db
        .insert(templateStages)
        .values({ templateId: tpl.id, stageId: stageIdByName(stageName), position: i + 1 })
        .onConflictDoNothing();
    }
  }

  await db
    .insert(expenseCategories)
    .values(EXPENSE_CATEGORIES.map((name) => ({ name })))
    .onConflictDoNothing();
}
