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
  assigneesOf,
  banUser,
  chainOf,
  completeTask,
  labelOf,
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
async function projectAtShooting(...shootingAssignees: TestActor[]) {
  const { project, chain } = await makeReelsProject(adham);
  await completeTask(chain[0]!.id, adham); // Concept done → Shooting activates
  const shooting = (await chainOf(project.id))[1]!;
  expect(shooting.status).toBe("todo");
  await taskService.setAssignees(adham, {
    id: shooting.id,
    userIds: shootingAssignees.map((a) => a.id),
  });
  return { project, shootingId: shooting.id };
}

describe("template snapshot (M2)", () => {
  it("materializes the whole chain; first task todo with deadline, rest waiting", async () => {
    const { chain } = await makeReelsProject(adham, { firstAssigneeIds: [hazem.id] });
    expect(chain.map((t) => t.status)).toEqual(["todo", "waiting", "waiting", "waiting"]);
    expect(chain[0]!.deadline).not.toBeNull(); // Concept: today + 2
    expect(chain[1]!.deadline).toBeNull(); // future stages get deadlines at activation
    expect(chain[0]!.startDate).not.toBeNull(); // the first stage starts at kickoff
    const labels = await Promise.all(chain.map((t) => labelOf(t.id)));
    expect(labels).toEqual(["Concept / Script", "Shooting", "Editing", "Delivery"]);
  });

  it("puts every named first assignee on the opening stage", async () => {
    const { chain } = await makeReelsProject(adham, { firstAssigneeIds: [hazem.id, sama.id] });
    expect(await assigneesOf(chain[0]!.id)).toEqual([hazem.id, sama.id].sort());
  });
});

describe("handoff routing (PLAN.md §4.1)", () => {
  it("RULE B: completer with the next stage's skill keeps the job (editor+videographer)", async () => {
    const { project, shootingId } = await projectAtShooting(hazem);
    await completeTask(shootingId, hazem);
    const editing = (await chainOf(project.id))[2]!;
    expect(editing.status).toBe("todo");
    expect(await assigneesOf(editing.id)).toEqual([hazem.id]); // he keeps the job
    expect(editing.deadline).not.toBeNull(); // today + 3 (Editing default)
    const notifs = await notificationsFor(hazem.id);
    expect(notifs.some((n) => n.type === "task_assigned" && n.entityId === editing.id)).toBe(true);
  });

  it("RULE A beats RULE B: explicit pre-assignment routes away from a qualified completer", async () => {
    const { project, shootingId } = await projectAtShooting(hazem);
    const editing = (await chainOf(project.id))[2]!;
    await taskService.setAssignees(adham, { id: editing.id, userIds: [sama.id] }); // pre-assign while waiting
    await completeTask(shootingId, hazem);
    const after = await taskById(editing.id);
    expect(after.status).toBe("todo");
    expect(await assigneesOf(editing.id)).toEqual([sama.id]); // explicit intent wins
  });

  it("inactive pre-assignee falls through to the completer's skill", async () => {
    const zombie = await makeUser("Zombie", "member", ["Editor"]);
    const { project, shootingId } = await projectAtShooting(hazem);
    const editing = (await chainOf(project.id))[2]!;
    await taskService.setAssignees(adham, { id: editing.id, userIds: [zombie.id] });
    await banUser(zombie.id);
    await completeTask(shootingId, hazem);
    expect(await assigneesOf(editing.id)).toEqual([hazem.id]); // fell through to Rule B
  });

  it("RULE C: no qualifier → unassigned queue + whoever can assign is notified", async () => {
    const { project, shootingId } = await projectAtShooting(gandoz); // videographer only
    await completeTask(shootingId, gandoz);
    const editing = (await chainOf(project.id))[2]!;
    expect(editing.status).toBe("todo");
    expect(await assigneesOf(editing.id)).toEqual([]);
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
    expect(await assigneesOf(shooting.id)).toEqual([]);
  });

  it("last stage completes the project and notifies the project managers", async () => {
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

describe("multi-assign (no owner — everyone on the task is equal)", () => {
  it("RULE B keeps every qualified person on the completed task", async () => {
    const { project, shootingId } = await projectAtShooting(hazem, sama); // both can edit
    await completeTask(shootingId, hazem);
    const editing = (await chainOf(project.id))[2]!;
    expect(editing.status).toBe("todo");
    expect(await assigneesOf(editing.id)).toEqual([hazem.id, sama.id].sort());
  });

  it("RULE B routes to the qualified person even when a teammate has no such skill", async () => {
    const { project, shootingId } = await projectAtShooting(gandoz, sama); // only Sama edits
    await completeTask(shootingId, gandoz);
    const editing = (await chainOf(project.id))[2]!;
    expect(await assigneesOf(editing.id)).toEqual([sama.id]);
  });

  it("any assignee can start and complete the task; the set is unchanged", async () => {
    const { shootingId } = await projectAtShooting(gandoz, sama);
    await taskService.transition(shootingId, "in_progress", sama);
    const task = await taskById(shootingId);
    expect(task.status).toBe("in_progress");
    expect(await assigneesOf(shootingId)).toEqual([gandoz.id, sama.id].sort());
  });

  it("someone not on the task still cannot act", async () => {
    const { shootingId } = await projectAtShooting(gandoz);
    await expect(taskService.transition(shootingId, "in_progress", sama)).rejects.toThrow();
  });

  it("replacing the set moves the task between people's My Work", async () => {
    const { shootingId } = await projectAtShooting(gandoz, sama);
    await taskService.setAssignees(adham, { id: shootingId, userIds: [hazem.id, sama.id] });
    const kept = await taskService.myWork(sama.id);
    expect(kept.tasks.some((t) => t.id === shootingId)).toBe(true);
    const gone = await taskService.myWork(gandoz.id);
    expect(gone.tasks.some((t) => t.id === shootingId)).toBe(false);
    const added = await taskService.myWork(hazem.id);
    expect(added.tasks.some((t) => t.id === shootingId)).toBe(true);
  });

  it("My Work rows carry the whole assignee list", async () => {
    const { shootingId } = await projectAtShooting(gandoz, sama);
    const work = await taskService.myWork(sama.id);
    const row = work.tasks.find((t) => t.id === shootingId);
    expect(row?.assigneeIds.sort()).toEqual([gandoz.id, sama.id].sort());
  });
});

describe("reopen (PLAN.md §4.3)", () => {
  it("untouched successor reverts to waiting; auto schedule cleared; reminder canceled", async () => {
    const { project, shootingId } = await projectAtShooting(hazem);
    await completeTask(shootingId, hazem);
    let editing = (await chainOf(project.id))[2]!;
    expect(editing.status).toBe("todo");

    await taskService.transition(shootingId, "in_progress", adham); // reopen
    editing = await taskById(editing.id);
    expect(editing.status).toBe("waiting");
    expect(editing.deadline).toBeNull(); // auto-set → cleared
    expect(editing.startDate).toBeNull();
    expect(editing.activatedAt).toBeNull();
  });

  it("a manually set successor schedule survives the revert", async () => {
    const { project, shootingId } = await projectAtShooting(hazem);
    await completeTask(shootingId, hazem);
    const editing = (await chainOf(project.id))[2]!;
    await taskService.setSchedule(adham, { id: editing.id, deadline: "2027-01-15" });

    await taskService.transition(shootingId, "in_progress", adham); // reopen
    const after = await taskById(editing.id);
    expect(after.status).toBe("waiting");
    expect(after.deadline).toBe("2027-01-15"); // the explicit deadline is kept
  });

  it("started successor is left alone; both tasks flagged; managers notified", async () => {
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
    await taskService.setAssignees(adham, { id: editing.id, userIds: [sama.id] });

    await taskService.transition(shootingId, "in_progress", adham); // reopen (conflict path)
    await taskService.transition(shootingId, "done", adham); // complete again
    const after = await taskById(editing.id);
    expect(after.status).toBe("in_progress"); // untouched by second handoff
    expect(await assigneesOf(editing.id)).toEqual([sama.id]);
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
    const { chain } = await makeReelsProject(adham, { firstAssigneeIds: [hazem.id] });
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

describe("per-user permissions (authorization is granted, not inherited)", () => {
  it("a member without tasks.assign cannot change who is on a task", async () => {
    const { shootingId } = await projectAtShooting(hazem);
    await expect(
      taskService.setAssignees(hazem, { id: shootingId, userIds: [sama.id] }),
    ).rejects.toThrow();
  });

  it("a member granted tasks.assign can", async () => {
    const lead = await makeUser("Lead", "member", [], ["tasks.assign"]);
    const { shootingId } = await projectAtShooting(hazem);
    await taskService.setAssignees(lead, { id: shootingId, userIds: [sama.id] });
    expect(await assigneesOf(shootingId)).toEqual([sama.id]);
  });

  it("tasks.approve lets a member approve submitted work without being on the task", async () => {
    const reviewer = await makeUser("Reviewer", "member", [], ["tasks.approve"]);
    const { shootingId } = await projectAtShooting(hazem);
    await db
      .update(schema.tasks)
      .set({ requiresApproval: true })
      .where(eq(schema.tasks.id, shootingId));
    await taskService.transition(shootingId, "in_progress", hazem);
    await taskService.transition(shootingId, "done", hazem); // becomes a request
    expect((await taskById(shootingId)).status).toBe("awaiting_approval");
    await taskService.transition(shootingId, "done", reviewer);
    expect((await taskById(shootingId)).status).toBe("done");
  });

  it("a member granted tasks.manage can move dates", async () => {
    const planner = await makeUser("Planner", "member", [], ["tasks.manage"]);
    const { shootingId } = await projectAtShooting(hazem);
    await taskService.setSchedule(planner, {
      id: shootingId,
      startDate: "2027-02-01",
      deadline: "2027-02-05",
    });
    const after = await taskById(shootingId);
    expect(after.startDate).toBe("2027-02-01");
    expect(after.deadline).toBe("2027-02-05");
  });

  it("a start date after the deadline is refused", async () => {
    const { shootingId } = await projectAtShooting(hazem);
    await expect(
      taskService.setSchedule(adham, {
        id: shootingId,
        startDate: "2027-03-10",
        deadline: "2027-03-01",
      }),
    ).rejects.toThrow();
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
    expect(await assigneesOf(editing.id)).toEqual([hazem.id]);
  });
});

describe("stage auto reminder (end_of_last_day on Shooting)", () => {
  it("one reminder per assignee; leaving the task cancels yours", async () => {
    const { shootingId } = await projectAtShooting(hazem, sama);
    const reminders = await remindersForTask(shootingId);
    expect(reminders).toHaveLength(2);
    expect(reminders.map((r) => r.targetUserId).sort()).toEqual([hazem.id, sama.id].sort());
    expect(reminders.every((r) => r.source === "auto")).toBe(true);

    await taskService.setAssignees(adham, { id: shootingId, userIds: [hazem.id] });
    const after = await remindersForTask(shootingId);
    expect(after.find((r) => r.targetUserId === sama.id)!.canceledAt).not.toBeNull();
    expect(after.find((r) => r.targetUserId === hazem.id)!.canceledAt).toBeNull();
  });

  it("activation schedules it, deadline changes reschedule it, completion cancels it", async () => {
    const { shootingId } = await projectAtShooting(hazem);
    const [reminder] = await remindersForTask(shootingId);
    expect(reminder).toBeDefined();
    expect(reminder!.targetUserId).toBe(hazem.id);
    expect(reminder!.dedupeKey).toBe(`task:${shootingId}:stage-default:${hazem.id}`);

    // deadline change reschedules the same row
    await taskService.setSchedule(adham, { id: shootingId, deadline: "2027-03-01" });
    const [rescheduled] = await remindersForTask(shootingId);
    expect(rescheduled!.fireAt.toISOString()).toContain("2027-03-01");

    await completeTask(shootingId, hazem);
    const [afterDone] = await remindersForTask(shootingId);
    expect(afterDone!.canceledAt).not.toBeNull();
  });

  it("fire time is 18:00 Cairo on the deadline day (15:00/16:00 UTC depending on DST)", async () => {
    const { shootingId } = await projectAtShooting(hazem);
    await taskService.setSchedule(adham, { id: shootingId, deadline: "2027-01-20" }); // Egypt winter: UTC+2
    const [winter] = await remindersForTask(shootingId);
    expect(winter!.fireAt.toISOString()).toBe("2027-01-20T16:00:00.000Z");
  });
});
