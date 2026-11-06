CREATE TABLE "requests" (
	"id" serial PRIMARY KEY,
	"kind" text NOT NULL,
	"order_number" text,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"message" text,
	"items" jsonb,
	"total" numeric(10,2),
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
