export function migrateGiftOptions(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(gifts)').all().map(column => column.name));
  db.exec('BEGIN');
  try {
    if (!columns.has('physical_enabled')) {
      db.exec("ALTER TABLE gifts ADD COLUMN physical_enabled INTEGER NOT NULL DEFAULT 0; UPDATE gifts SET physical_enabled=1 WHERE category='casa';");
    }
    if (!columns.has('product_url')) db.exec("ALTER TABLE gifts ADD COLUMN product_url TEXT NOT NULL DEFAULT '';");
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
