import { eq } from "drizzle-orm";
import { schema } from "@mams/db";
import type { Db } from "../db";

/**
 * Test-only reference data.
 *
 * Production runs one chain — Shooting → Editing (see `@mams/db/seed-data`) —
 * but the handoff engine is a general chain machine, and a two-link chain
 * cannot exercise "the middle of a chain": activation of a successor that is
 * itself followed by something, reopen conflicts, mid-chain reassignment. So
 * the suite keeps its own four-stage "Reels / Video" template here rather than
 * holding the shipped seed hostage to what the tests happen to need.
 */
const EXTRA_SKILLS = ["Designer", "Copywriter", "Creative", "Account Manager"] as const;

const EXTRA_STAGES: {
  name: string;
  skills: string[];
  days: number;
  reminderRule: "none" | "end_of_last_day";
}[] = [
  { name: "Concept / Script", skills: ["Creative", "Copywriter"], days: 2, reminderRule: "none" },
  { name: "Delivery", skills: ["Account Manager"], days: 1, reminderRule: "none" },
];

const CHAIN = ["Concept / Script", "Shooting", "Editing", "Delivery"];

export async function seedTestWorkflow(db: Db) {
  await db
    .insert(schema.skills)
    .values(EXTRA_SKILLS.map((name) => ({ name })))
    .onConflictDoNothing();
  const skillRows = await db.select().from(schema.skills);
  const skillId = (name: string) => {
    const row = skillRows.find((s) => s.name === name);
    if (!row) throw new Error(`fixture: missing skill ${name}`);
    return row.id;
  };

  for (const [i, stage] of EXTRA_STAGES.entries()) {
    await db
      .insert(schema.stages)
      .values({
        name: stage.name,
        defaultDurationDays: stage.days,
        reminderRule: stage.reminderRule,
        sortOrder: 10 + i,
      })
      .onConflictDoNothing();
    const [row] = await db.select().from(schema.stages).where(eq(schema.stages.name, stage.name));
    if (!row) throw new Error(`fixture: stage ${stage.name} not found`);
    await db
      .insert(schema.stageSkills)
      .values(stage.skills.map((s) => ({ stageId: row.id, skillId: skillId(s) })))
      .onConflictDoNothing();
  }

  const stageRows = await db.select().from(schema.stages);
  const stageIdByName = (name: string) => {
    const row = stageRows.find((s) => s.name === name);
    if (!row) throw new Error(`fixture: missing stage ${name}`);
    return row.id;
  };

  await db
    .insert(schema.workflowTemplates)
    .values({ name: "Reels / Video" })
    .onConflictDoNothing();
  const [tpl] = await db
    .select()
    .from(schema.workflowTemplates)
    .where(eq(schema.workflowTemplates.name, "Reels / Video"));
  if (!tpl) throw new Error("fixture: template not found");
  for (const [i, stageName] of CHAIN.entries()) {
    await db
      .insert(schema.templateStages)
      .values({ templateId: tpl.id, stageId: stageIdByName(stageName), position: i + 1 })
      .onConflictDoNothing();
  }
}
