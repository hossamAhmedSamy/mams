CREATE TABLE "leave_allowances" (
	"user_id" text NOT NULL,
	"year" integer NOT NULL,
	"annual_days" integer NOT NULL,
	"casual_days" integer NOT NULL,
	"sick_days" integer NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_allowances_user_id_year_pk" PRIMARY KEY("user_id","year")
);
--> statement-breakpoint
CREATE TABLE "leave_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"days" integer NOT NULL,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"deduct_from_salary" numeric(12, 2),
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_requests_type_check" CHECK ("leave_requests"."type" IN ('annual','casual','sick','unpaid')),
	CONSTRAINT "leave_requests_status_check" CHECK ("leave_requests"."status" IN ('pending','approved','rejected','canceled')),
	CONSTRAINT "leave_requests_span_check" CHECK ("leave_requests"."end_date" >= "leave_requests"."start_date"),
	CONSTRAINT "leave_requests_days_check" CHECK ("leave_requests"."days" > 0)
);
--> statement-breakpoint
CREATE TABLE "payroll_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payslip_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"note" text,
	"leave_request_id" uuid,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_adjustments_kind_check" CHECK ("payroll_adjustments"."kind" IN ('bonus','deduction','advance','leave_deduction')),
	CONSTRAINT "payroll_adjustments_amount_check" CHECK ("payroll_adjustments"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "payslips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"period" text NOT NULL,
	"base_amount" numeric(12, 2) NOT NULL,
	"net_amount" numeric(12, 2) NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"note" text,
	"paid_on" date,
	"paid_by" text,
	"paid_at" timestamp with time zone,
	"expense_id" uuid,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payslips_period_check" CHECK ("payslips"."period" ~ '^[0-9]{4}-[0-9]{2}$'),
	CONSTRAINT "payslips_status_check" CHECK ("payslips"."status" IN ('draft','paid'))
);
--> statement-breakpoint
CREATE TABLE "salaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"monthly_amount" numeric(12, 2) NOT NULL,
	"effective_from" date NOT NULL,
	"note" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "salaries_amount_check" CHECK ("salaries"."monthly_amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "leave_allowances" ADD CONSTRAINT "leave_allowances_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_allowances" ADD CONSTRAINT "leave_allowances_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_payslip_id_payslips_id_fk" FOREIGN KEY ("payslip_id") REFERENCES "public"."payslips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_leave_request_id_leave_requests_id_fk" FOREIGN KEY ("leave_request_id") REFERENCES "public"."leave_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_paid_by_user_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salaries" ADD CONSTRAINT "salaries_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salaries" ADD CONSTRAINT "salaries_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leave_requests_user_start_idx" ON "leave_requests" USING btree ("user_id","start_date");--> statement-breakpoint
CREATE INDEX "leave_requests_status_idx" ON "leave_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "leave_requests_span_idx" ON "leave_requests" USING btree ("start_date","end_date");--> statement-breakpoint
CREATE INDEX "payroll_adjustments_payslip_idx" ON "payroll_adjustments" USING btree ("payslip_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_adjustments_leave_uq" ON "payroll_adjustments" USING btree ("payslip_id","leave_request_id") WHERE "payroll_adjustments"."leave_request_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "payslips_user_period_uq" ON "payslips" USING btree ("user_id","period");--> statement-breakpoint
CREATE INDEX "payslips_period_idx" ON "payslips" USING btree ("period");--> statement-breakpoint
CREATE UNIQUE INDEX "salaries_user_effective_uq" ON "salaries" USING btree ("user_id","effective_from");