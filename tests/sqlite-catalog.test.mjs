import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrateGiftOptions } from '../lib/sqlite-catalog.mjs';

test('local catalog migration preserves existing gifts and only runs defaults once', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec("CREATE TABLE gifts (id INTEGER PRIMARY KEY, name TEXT, category TEXT, amount REAL); INSERT INTO gifts VALUES (1,'Taças','casa',123.45),(2,'Passeio','experiencias',80);");
    migrateGiftOptions(db);
    const gifts = db.prepare('SELECT * FROM gifts ORDER BY id').all();
    assert.equal(gifts[0].name, 'Taças'); assert.equal(gifts[0].amount, 123.45);
    assert.equal(gifts[0].physical_enabled, 1); assert.equal(gifts[1].physical_enabled, 0);
    assert.equal(gifts[0].product_url, '');
    db.exec("UPDATE gifts SET physical_enabled=0, product_url='https://loja.example/item' WHERE id=1;");
    migrateGiftOptions(db);
    const saved = db.prepare('SELECT * FROM gifts WHERE id=1').get();
    assert.equal(saved.physical_enabled, 0); assert.equal(saved.product_url, 'https://loja.example/item');
  } finally { db.close(); }
});
