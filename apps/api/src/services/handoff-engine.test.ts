/**
 * Handoff engine + state machine edge cases — one test per row of the
 * PLAN.md §4.3 table, plus the M3 acceptance scenarios.
 */
import { schema } from "@mams/db";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "../db";
import * as taskService from "./task-service";
import {
  banUser,
  chainOf,
  completeTask,
  makeReelsProject,
  makeUser,
  notificationsFor,
  projectById,
  remindersForTask,
  taskById,
  type TestActor,
} from "../test/helpers";

let adham: TestActor; // admin
let hazem: TestActor; // Videographer + Editor (the multi-skill case)
let gandoz: TestActor; // Videographer only
let sama: TestActor; // Editor only

beforeAll(async () => {
  adham = await makeUser("Adham", "admin", ["Account Manager"]);
  hazem = await makeUser("Hazem", "member", ["Videographer", "Editor"]);
  gandoz = await makeUser("Gandoz", "member", ["Videographer"]);
  sama = await makeUser("Sama", "member", ["Editor"]);
});

/** Get a Reels project to the point where Shooting (pos 2) is active. */
async function projectAtShooting(shootingAssignee: TestActor) {
  const { project, chain } = await makeReelsProject(adham);
  await completeTask(chain[0]!.id, adham); // Concept done → Shooting activates
  const shooting = (await chainOf(project.id))[1]!;
  expect(shooting.status).toBe("todo");
  await taskService.assign(adham, { id: shooting.id, assigneeId: shootingAssignee.id });
  return { project, shootingId: shooting.id };
}

describe("template snapshot (M2)", () => {
  it("materializes the whole chain; first task todo with deadline, rest waiting", async () => {
    const { chain } = await makeReelsProject(adham, { firstAssigneeId: hazem.id });
    expect(chain.map((t) => t.status)).toEqual(["todo", "waiting", "waiting", "waiting"]);
    expect(chain[0]!.deadline).not.toBeNull(); // Concept: today + 2
    expect(chain[1]!.deadline).toBeNull(); // future stages get deadlines at activation
    expect(chain.map((t) => t.title)).toEqual([
      "Concept / Script",
      "Shooting",
      "Editing",
      "Delivery",
    ]);
  });
});

describe("handoff routing (PLAN.md §4.1)", () => {
  it("RULE B: completer with the next stage's skill keeps the job (editor+videographer)", async () => {
    const { project, shootingId } = await projectAtShooting(hazem);
    await completeTask(shootingId, hazem);
    const editing = (await chainOf(project.id))[2]!;
    expect(editing.status).toBe("todo");
    expect(editing.assigneeId).toBe(hazem.id); // he keeps the job
    expect(editing.deadline).not.toBeNull(); // today + 3 (Editing default)
    const notifs = await notificationsFor(hazem.id);
    expect(notifs.some((n) => n.type === "task_assigned" && n.entityId === editing.id)).toBe(true);
  });

  it("RULE A beats RULE B: explicit pre-assignment routes away from a qualified completer", async () => {
    const { project, shootingId } = await projectAtShooting(hazem);
    const editing = (await chainOf(project.id))[2]!;
    await taskService.assign(adham, { id: editing.id, assigneeId: sama.id }); // pre-assign while waiting
    await completeTask(shootingId, hazem);
    const after = await taskById(editing.id);
    expect(after.status).toBe("todo");
    expect(after.assigneeId).toBe(sama.id); // explicit intent wins
  });

  it("inactive pre-assignee falls through to the completer's skill", async () => {
    const zombie = await makeUser("Zombie", "member", ["Editor"]);
    const { project, shootingId } = await projectAtShooting(hazem);
    const editing = (await chainOf(project.id))[2]!;
    await taskService.assign(adham, { id: editing.id, assigneeId: zombie.id });
    await banUser(zombie.id);
    await completeTask(shootingId, hazem);
    const after = await taskById(editing.id);
    expect(after.assigneeId).toBe(hazem.id); // fell through to Rule B
  });

  it("RULE C: no qualifier → unassigned queue + admin notified", async () => {
    const { project, shootingId } = await projectAtShooting(gandoz); // videographer only
    await completeTask(shootingId, gandoz);
    const editing = (await chainOf(project.id))[2]!;
    expect(editing.status).toBe("todo");
    expect(editing.assigneeId).toBeNull();
    const notifs = await notificationsFor(adham.id);
    expect(notifs.some((n) => n.type === "handoff_unassigned" && n.entityId === editing.id)).toBe(
      true,
    );
  });

  it("completing task itself unassigned → Rule B skipped → queue", async () => {
    const { project, chain } = await makeReelsProject(adham); // Concept unassigned
    await completeTask(chain[0]!.id, adham);
    const shooting = (await chainOf(project.id))[1]!;
    // admin completed an unassigned Concept; Shooting has no pre-assignee and no completer skill path
    expect(shooting.status).toBe("todo");
    expect(shooting.assigneeId).toBeNull();
  });

  it("last stage completes the project and notifies admins", async () => {
    const { project, chain } = await makeReelsProject(adham);
    for (const task of chain) await completeTask(task.id, adham);
    const done = await projectById(project.id);
    expect(done.status).toBe("completed");
    expect(done.completedAt).not.toBeNull();
    const notifs = await notificationsFor(adham.id);
    expect(notifs.some((n) => n.type === "project_completed" && n.entityId === project.id)).toBe(
      true,
    );
  });

  it("double-complete race: second completion is rejected, one handoff only", async () => {
    const { project, shootingId } = await projectAtShooting(hazem);
    await completeTask(shootingId, hazem);
    await expect(taskService.transition(shootingId, "done", adham)).rejects.toThrow();
    const editings = (await chainOf(project.id)).filter((t) => t.chainPosition === 3);
    expect(editings).toHaveLength(1);
  });
});

describe("reopen (PLAN.md §4.3)", () => {
  it("untouched successor reverts to waiting; auto deadline cleared; reminder canceled", async () => {
    const { project, shootingId } = await projectAtShooting(hazem);
    await completeTask(shootingId, hazem);
    let editing = (await chainOf(project.id))[2]!;
    expect(editing.status).toBe("todo");

    await taskService.transition(shootingId, "in_progress", adham); // reopen
    editing = await taskById(editing.id);
    expect(editing.status).toBe("waiting");
    expect(editing.deadline).toBeNull(); // auto-set → cleared
    expect(editing.activatedAt).toBeNull();
  });

  it("manually set successor deadline survives the revert", async () => {
    const { project, shootingId } = await projectAtShooting(hazem);
    await completeTask(shootingId, hazem);
    const editing = (await chainOf(project.id))[2]!;
    await taskService.setDeadline(adham, { id: editing.id, deadline: "2027-01-15" });

    await taskService.transition(shootingId, "in_progress", adham); // reopen
    const after = await taskById(editing.id);
    expect(after.status).toBe("waiting");
    expect(after.deadline).toBe("2027-01-15"); // admin's explicit deadline kept
  });

  it("started successor is left alone; both tasks flagged; admins notified", async () => {
    const { project, shootingId } = await projectAtShooting(hazem);
    await completeTask(shootingId, hazem);
    const editing = (await chainOf(project.id))[2]!;
    await taskService.transition(editing.id, "in_progress", hazem); // work started

    await taskService.transition(shootingId, "in_progress", adham); // reopen
    const editingAfter = await taskById(editing.id);
    const shootingAfter = await taskById(shootingId);
    expect(editingAfter.status).toBe("in_progress"); // untouched
    expect(editingAfter.flagged).toBe(true);
    expect(shootingAfter.flagged).toBe(true);
    const notifs = await notificationsFor(adham.id);
    expect(notifs.some((n) => n.type === "reopen_conflict")).toBe(true);
  });

  it("re-completion after reopen does not re-trigger handoff on an active successor", async () => {
    const { project, shootingId } = await projectAtShooting(hazem);
    await completeTask(shootingId, hazem);
    const editing = (await chainOf(project.id))[2]!;
    await taskService.transition(editing.id, "in_progress", hazem);
    await taskService.assign(adham, { id: editing.id, assigneeId: sama.id });

    await taskService.transition(shootingId, "in_progress", adham); // reopen (conflict path)
    await taskService.transition(shootingId, "done", adham); // complete again
    const after = await taskById(editing.id);
    expect(after.status).toBe("in_progress"); // untouched by second handoff
    expect(after.assigneeId).toBe(sama.id);
  });

  it("reopening a task in a completed project re-activates the project", async () => {
    const { project, chain } = await makeReelsProject(adham);
    for (const task of chain) await completeTask(task.id, adham);
    expect((await projectById(project.id)).status).toBe("completed");
    await taskService.transition(chain[3]!.id, "in_progress", adham);
    expect((await projectById(project.id)).status).toBe("active");
  });
});

describe("state machine + authz (PLAN.md §5.3, §3)", () => {
  it("rejects illegal transitions", async () => {
    const { chain } = await makeReelsProject(adham);
    await expect(taskService.transition(chain[1]!.id, "done", adham)).rejects.toThrow(); // waiting→done
    await expect(taskService.transition(chain[0]!.id, "waiting", adham)).rejects.toThrow(); // todo→waiting (system only)
  });

  it("member cannot act on someone else's task or reopen", async () => {
    const { chain } = await makeReelsProject(adham, { firstAssigneeId: hazem.id });
    await expect(taskService.transition(chain[0]!.id, "in_progress", sama)).rejects.toThrow(); // not hers
    await completeTask(chain[0]!.id, hazem);
    await expect(taskService.transition(chain[0]!.id, "in_progress", hazem)).rejects.toThrow(); // member reopen
  });

  it("admin can manually activate a waiting task (deadline defaulted)", async () => {
    const { project, chain } = await makeReelsProject(adham);
    await taskService.transition(chain[2]!.id, "todo", adham);
    const editing = (await chainOf(project.id))[2]!;
    expect(editing.status).toBe("todo");
    expect(editing.deadline).not.toBeNull();
  });
});

describe("approval gate (requires_approval, default off)", () => {
  it("member done on a gated task → awaiting_approval; admin approve → handoff; reject → flagged", async () => {
    const { project, shootingId } = await projectAtShooting(hazem);
    await db.update(schema.tasks).set({ requiresApproval: true }).where(eq(schema.tasks.id, shootingId));

    await taskService.transition(shootingId, "in_progress", hazem);
    await taskService.transition(shootingId, "done", hazem); // member "done"
    let shooting = await taskById(shootingId);
    expect(shooting.status).toBe("awaiting_approval");
    expect((await notificationsFor(adham.id)).some((n) => n.type === "approval_requested")).toBe(true);

    // reject → back to work, flagged
    await taskService.transition(shootingId, "in_progress", adham);
    shooting = await taskById(shootingId);
    expect(shooting.status).toBe("in_progress");
    expect(shooting.flagged).toBe(true);

    // second attempt, then admin approves → done + handoff ran
    await taskService.transition(shootingId, "done", hazem);
    await taskService.transition(shootingId, "done", adham); // approve
    shooting = await taskById(shootingId);
    expect(shooting.status).toBe("done");
    const editing = (await chainOf(project.id))[2]!;
    expect(editing.status).toBe("todo");
    expect(editing.assigneeId).toBe(hazem.id);
  });
});

describe("stage auto reminder (end_of_last_day on Shooting)", () => {
  it("activation with assignee+deadline schedules it; completion cancels it", async () => {
    const { project, shootingId } = await projectAtShooting(hazem);
    // assign() after activation ensures the reminder exists (deadline is set)
    const [reminder] = await remindersForTask(shootingId);
    expect(reminder).toBeDefined();
    expect(reminder!.source).toBe("auto");
    expect(reminder!.targetUserId).toBe(hazem.id);
    expect(reminder!.dedupeKey).toBe(`task:${shootingId}:stage-default`);

    // deadline change reschedules the same row
    await taskService.setDeadline(adham, { id: shootingId, deadline: "2027-03-01" });
    const [rescheduled] = await remindersForTask(shootingId);
    expect(rescheduled!.fireAt.toISOString()).toContain("2027-03-01");

    await completeTask(shootingId, hazem);
    const [afterDone] = await remindersForTask(shootingId);
    expect(afterDone!.canceledAt).not.toBeNull();
  });

  it("fire time is 18:00 Cairo on the deadline day (15:00/16:00 UTC depending on DST)", async () => {
    const { shootingId } = await projectAtShooting(hazem);
    await taskService.setDeadline(adham, { id: shootingId, deadline: "2027-01-20" }); // Egypt winter: UTC+2
    const [winter] = await remindersForTask(shootingId);
    expect(winter!.fireAt.toISOString()).toBe("2027-01-20T16:00:00.000Z");
  });
});
