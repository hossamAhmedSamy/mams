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

/**
 * The agency runs one shape of work (owner, 2026-08-02): a campaign is shot,
 * then it is edited, and the owner signs the edit off. Everything else the
 * team does hangs off those two stages, so the reference data is exactly that
 * chain — not a menu of workflows nobody picks between.
 */
const SKILLS = ["Videographer", "Photographer", "Editor"] as const;

const STAGES: {
  name: string;
  skills: string[];
  days: number;
  reminderRule: "none" | "end_of_last_day";
}[] = [
  // a shoot is a day on location; the reminder lands when that day ends
  { name: "Shooting", skills: ["Videographer", "Photographer"], days: 1, reminderRule: "end_of_last_day" },
  { name: "Editing", skills: ["Editor"], days: 3, reminderRule: "none" },
];

/**
 * `approve` marks the stage that comes back to the owner before it counts as
 * done — the control point that makes this a work regulator rather than a list.
 */
const TEMPLATES: { name: string; chain: { stage: string; approve?: boolean }[] }[] = [
  {
    name: "Campaign",
    chain: [{ stage: "Shooting" }, { stage: "Editing", approve: true }],
  },
];

const EXPENSE_CATEGORIES = [
  // paid payslips post themselves into this one — hr-service looks it up by name
  "Salaries",
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
    for (const [i, step] of t.chain.entries()) {
      await db
        .insert(templateStages)
        .values({
          templateId: tpl.id,
          stageId: stageIdByName(step.stage),
          position: i + 1,
          requiresApproval: step.approve ?? false,
        })
        .onConflictDoNothing();
    }
  }

  await db
    .insert(expenseCategories)
    .values(EXPENSE_CATEGORIES.map((name) => ({ name })))
    .onConflictDoNothing();
}
