CREATE TABLE "task_assignees" (
	"task_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "task_assignees_task_id_user_id_pk" PRIMARY KEY("task_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_assignees_user_idx" ON "task_assignees" USING btree ("user_id");
-- backfill: existing owners become assignee rows
INSERT INTO "task_assignees" ("task_id", "user_id")
SELECT "id", "assignee_id" FROM "tasks" WHERE "assignee_id" IS NOT NULL
ON CONFLICT DO NOTHING;
