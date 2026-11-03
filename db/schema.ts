import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// Runtime handlers never create or modify migration-owned tables.
export const appOwner = sqliteTable("app_owner", {
  id: integer("id").primaryKey(),
  userId: text("user_id").notNull().unique(),
  email: text("email").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [check("one_owner", sql`${table.id} = 1`)]);

export const stores = sqliteTable("stores", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  userId: text("user_id"),
  credits: integer("credits").notNull().default(0),
  unlimited: integer("unlimited").notNull().default(0),
  unlimitedUntil: integer("unlimited_until"),
  logoKey: text("logo_key"),
  logoMime: text("logo_mime"),
  logoMode: text("logo_mode").notNull().default("original"),
  deletedAt: integer("deleted_at"),
  inviteHash: text("invite_hash"),
  inviteExpiresAt: integer("invite_expires_at"),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  uniqueIndex("stores_email_unique").on(table.email).where(sql`${table.deletedAt} IS NULL`),
  uniqueIndex("stores_user_unique").on(table.userId).where(sql`${table.deletedAt} IS NULL`),
  uniqueIndex("stores_invite_unique").on(table.inviteHash).where(sql`${table.deletedAt} IS NULL`),
  check("stores_nonnegative_credits", sql`${table.credits} >= 0`),
]);

export const cards = sqliteTable("cards", {
  id: text("id").primaryKey(),
  storeId: text("store_id").notNull().references(() => stores.id, { onDelete: "restrict" }),
  recipient: text("recipient").notNull(),
  sender: text("sender").notNull().default(""),
  occasion: text("occasion").notNull().default("especial"),
  theme: text("theme", { enum: ["rosa", "olivo", "noche"] }).notNull().default("rosa"),
  printColor: text("print_color"),
  greetingColor: text("greeting_color"),
  consentAt: integer("consent_at"),
  consentVersion: text("consent_version"),
  giftOptions: text("gift_options").notNull().default("{}"),
  audioKey: text("audio_key"),
  activationHash: text("activation_hash"),
  sealOnPublish: integer("seal_on_publish").notNull().default(0),
  sealed: integer("sealed").notNull().default(0),
  pinHash: text("pin_hash"),
  pinFailures: integer("pin_failures").notNull().default(0),
  pinLockedUntil: integer("pin_locked_until").notNull().default(0),
  logoMode: text("logo_mode"),
  deletedAt: integer("deleted_at"),
  status: text("status", { enum: ["draft", "published"] }).notNull().default("draft"),
  letter: text("letter").notNull().default(""),
  editHash: text("edit_hash").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at").notNull(),
  publishedAt: integer("published_at"),
}, (table) => [
  index("cards_store_index").on(table.storeId),
  uniqueIndex("cards_edit_hash_unique").on(table.editHash),
  check("cards_theme_valid", sql`${table.theme} IN ('rosa', 'olivo', 'noche')`),
  check("cards_status_valid", sql`${table.status} IN ('draft', 'published')`),
]);

export const photos = sqliteTable("photos", {
  id: text("id").primaryKey(),
  cardId: text("card_id").notNull().references(() => cards.id, { onDelete: "cascade" }),
  storageKey: text("storage_key").notNull().unique(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [index("photos_card_index").on(table.cardId)]);

export const packages = sqliteTable("packages", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["credits", "unlimited"] }).notNull(),
  credits: integer("credits"),
  priceCents: integer("price_cents"),
  currency: text("currency").notNull().default("USD"),
  durationDays: integer("duration_days"),
  active: integer("active").notNull().default(1),
}, (table) => [
  check("packages_kind_valid", sql`${table.kind} IN ('credits', 'unlimited')`),
  check("packages_active_valid", sql`${table.active} IN (0, 1)`),
  check("packages_price_valid", sql`${table.priceCents} IS NULL OR ${table.priceCents} >= 0`),
  check("packages_quantity_valid", sql`(${table.kind} = 'credits' AND ${table.credits} BETWEEN 1 AND 10000 AND ${table.durationDays} IS NULL) OR (${table.kind} = 'unlimited' AND ${table.credits} IS NULL AND (${table.durationDays} IS NULL OR ${table.durationDays} > 0))`),
]);

export const orders = sqliteTable("orders", {
  id: text("id").primaryKey(),
  storeId: text("store_id").notNull().references(() => stores.id, { onDelete: "restrict" }),
  packageId: text("package_id").notNull(),
  packageName: text("package_name").notNull(),
  kind: text("kind", { enum: ["credits", "unlimited"] }).notNull(),
  credits: integer("credits"),
  priceCents: integer("price_cents"),
  currency: text("currency").notNull(),
  durationDays: integer("duration_days"),
  status: text("status", { enum: ["pending", "approved", "rejected"] }).notNull().default("pending"),
  note: text("note").notNull().default(""),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at").notNull(),
  decidedBy: text("decided_by"),
  decidedAt: integer("decided_at"),
}, (table) => [
  index("orders_store_index").on(table.storeId),
  check("orders_status_valid", sql`${table.status} IN ('pending', 'approved', 'rejected')`),
  check("orders_kind_valid", sql`${table.kind} IN ('credits', 'unlimited')`),
  check("orders_quantity_valid", sql`(${table.kind} = 'credits' AND ${table.credits} BETWEEN 1 AND 10000 AND ${table.durationDays} IS NULL) OR (${table.kind} = 'unlimited' AND ${table.credits} IS NULL AND (${table.durationDays} IS NULL OR ${table.durationDays} > 0))`),
]);
export const creditLedger = sqliteTable("credit_ledger", {
  id: text("id").primaryKey(),
  storeId: text("store_id").notNull().references(() => stores.id, { onDelete: "restrict" }),
  cardId: text("card_id").references(() => cards.id, { onDelete: "restrict" }),
  orderId: text("order_id").references(() => orders.id, { onDelete: "restrict" }),
  amount: integer("amount").notNull(),
  reason: text("reason").notNull(),
  note: text("note").notNull().default(""),
  actorId: text("actor_id").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  index("credit_ledger_store_index").on(table.storeId),
  uniqueIndex("credit_ledger_card_unique").on(table.cardId),
  uniqueIndex("credit_ledger_order_unique").on(table.orderId),
]);

export const giftSessions = sqliteTable("gift_sessions", {
 tokenHash: text("token_hash").primaryKey(),
 cardId: text("card_id").notNull().references(()=>cards.id,{onDelete:"cascade"}),
 pinVersion: text("pin_version").notNull(),
 expiresAt: integer("expires_at").notNull(),
},table=>[index("gift_sessions_card_index").on(table.cardId)]);

export const legalSettings=sqliteTable("legal_settings",{id:integer("id").primaryKey(),data:text("data").notNull(),updatedAt:integer("updated_at").notNull()});
export const legalConsents=sqliteTable("legal_consents",{id:text("id").primaryKey(),actor:text("actor").notNull(),kind:text("kind").notNull(),version:text("version").notNull(),createdAt:integer("created_at").notNull()});
export const removalRequests=sqliteTable("removal_requests",{id:text("id").primaryKey(),cardId:text("card_id").notNull().unique().references(()=>cards.id),email:text("email").notNull(),reason:text("reason").notNull(),status:text("status").notNull().default("pending"),createdAt:integer("created_at").notNull(),processedAt:integer("processed_at")});
