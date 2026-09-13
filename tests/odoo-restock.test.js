import test from 'node:test';
import assert from 'node:assert/strict';
import {readOdooRestock} from '../app/services/odooRestock.js';
const today='2026-09-12';
test('pending receipt dates win over completed receipts and past deadlines',async()=>{
 const calls=[];
 const rpc=async(model,method,args,kwargs)=>{
  calls.push({model,method,args,kwargs});
  if(model==='product.product') return [{id:1}];
  assert.deepEqual(args[0].find(row=>row[0]==='state'),['state','in',['assigned','confirmed','waiting']]);
  assert.equal(kwargs.limit,1);
  if(kwargs.order.startsWith('date_deadline')) return [{date_deadline:'2026-10-01 10:00:00',write_date:'2026-09-11 12:00:00'}];
  assert.ok(args[0].some(row=>row[0]==='date_deadline'&&row[1]==='='&&row[2]===false));
  return [{date:'2026-09-20 10:00:00',write_date:'2026-09-10 12:00:00'}];
 };
 const result=await readOdooRestock({rpc,sku:'SKU',today});
 assert.equal(result.estimatedDate,'2026-09-20');assert.equal(result.scheduleStatus,'SCHEDULED');assert.equal(result.updatedAt,'2026-09-10T12:00:00Z');assert.equal(calls.length,3);
});
test('overdue or undated pending goods request date confirmation, not a false arrival promise',async()=>{
 for(const pending of [0,6]){
  const rpc=async(model,method)=>model==='product.product'?[{id:1}]:method==='search_count'?pending:[];
  const result=await readOdooRestock({rpc,sku:'SKU',today});
  assert.equal(result.estimatedDate,null);assert.equal(result.scheduleStatus,pending?'DATE_CONFIRMATION_REQUIRED':'NOT_PLANNED');
 }
});
test('Odoo errors remain errors, never successful empty schedules',async()=>{
 await assert.rejects(readOdooRestock({rpc:async()=>{throw new Error('unavailable');},sku:'SKU',today}));
 await assert.rejects(readOdooRestock({rpc:async()=>null,sku:'SKU',today}));
});
