import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { requestContext } from '../src/context.js';
import { patchMongoose, patchMysql2 } from '../src/hooks.js';
import { store } from '../src/store.js';

const require = createRequire(import.meta.url);
const queries = () => store.all().filter((e) => e.kind === 'query');

describe('database hooks (no database server needed: the failures are the test)', () => {
  it('records mongoose queries with collection, filter keys, time and the error', async () => {
    const mongoose = require('mongoose') as typeof import('mongoose');
    expect(patchMongoose(mongoose)).toBe(true);
    expect(patchMongoose(mongoose)).toBe(true); // patching twice is safe
    mongoose.set('bufferTimeoutMS', 300); // no database here, so fail fast
    const Order = mongoose.model('Order', new mongoose.Schema({ status: String, userId: String }));

    store.clear();
    await requestContext.run({ requestId: 'r1', actionId: 'a1' }, async () => {
      await expect(Order.find({ status: 'paid', userId: 'u1' }).exec()).rejects.toThrow();
    });
    await Order.find({})
      .exec()
      .catch(() => undefined); // outside a request: not recorded

    expect(queries()).toHaveLength(1);
    expect(queries()[0]).toMatchObject({
      side: 'db',
      requestId: 'r1',
      actionId: 'a1',
      level: 'error',
      text: 'orders.find({ status, userId })',
      data: { db: 'mongodb', error: expect.any(String) },
    });
    expect(JSON.stringify(queries())).not.toContain('paid'); // filter values are not kept
  }, 15_000); // loading mongoose the first time can be slow when the whole suite runs at once

  it('records mysql2 pool and connection queries without their values', async () => {
    const mysql = require('mysql2') as typeof import('mysql2');
    expect(patchMysql2(mysql)).toBe(true);
    const pool = mysql.createPool({ host: '127.0.0.1', port: 3399, user: 'x', connectTimeout: 1000 });

    store.clear();
    await requestContext.run({ requestId: 'r2' }, () => {
      return new Promise<void>((resolve) => {
        pool.query('SELECT  qty\n FROM stock WHERE id = ?', ['secret-id'], (err) => {
          expect(err).toBeTruthy();
          resolve();
        });
      });
    });
    await pool
      .promise()
      .end()
      .catch(() => undefined);

    expect(queries()).toHaveLength(1);
    expect(queries()[0]).toMatchObject({
      requestId: 'r2',
      level: 'error',
      text: 'SELECT qty FROM stock WHERE id = ?',
      data: {
        db: 'mysql',
        values: '1 value(s), not recorded',
        error: expect.stringContaining('ECONNREFUSED'),
      },
    });
    expect(JSON.stringify(queries())).not.toContain('secret-id');
  }, 15_000);
});
