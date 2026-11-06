import { pgTable, serial, text, timestamp, numeric, jsonb } from "drizzle-orm/pg-core";

// Orders and contact messages from customers, shown on the private /admin page.
export const requests = pgTable("requests", {
  id: serial().primaryKey(),
  kind: text().notNull(), // "order" or "message"
  orderNumber: text("order_number"),
  name: text().notNull(),
  email: text(),
  phone: text(),
  message: text(), // contact message, or order notes
  meetupPlace: text("meetup_place"), // where the customer wants to meet (orders)
  meetupTime: text("meetup_time"), // when they want to meet, as the customer picked it
  items: jsonb().$type<{ name: string; option: string; quantity: number; price: number }[]>(),
  total: numeric({ precision: 10, scale: 2 }),
  status: text().notNull().default("new"), // "new" or "done"
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
