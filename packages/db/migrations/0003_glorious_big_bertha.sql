CREATE TABLE "user_permissions" (
	"user_id" text NOT NULL,
	"permission" text NOT NULL,
	CONSTRAINT "user_permissions_user_id_permission_pk" PRIMARY KEY("user_id","permission")
);
--> statement-breakpoint
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
--- Owners become plain assignees before the column goes away (they were already
--- mirrored into task_assignees, but never trust a mirror at migration time).
INSERT INTO "task_assignees" ("task_id", "user_id")
SELECT "id", "assignee_id" FROM "tasks" WHERE "assignee_id" IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint
--- Ad-hoc tasks were named by free text; where that text names a real stage,
--- keep the meaning by attaching the stage the task is now titled by.
UPDATE "tasks" AS t SET "stage_id" = s."id"
FROM "stages" AS s WHERE t."stage_id" IS NULL AND lower(s."name") = lower(t."title");--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_assignee_id_user_id_fk";
--> statement-breakpoint
DROP INDEX "tasks_assignee_status_idx";--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "title";--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "assignee_id";
