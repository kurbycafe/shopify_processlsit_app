import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const source = await fs.readFile(new URL('../app/routes/app.app-management.jsx', import.meta.url), 'utf8');
const start = source.indexOf('function reconcileDraft(');
const functionSource = source.slice(start, source.indexOf('\n}', start) + 2);
const context = vm.createContext({});
vm.runInContext(functionSource + '\nglobalThis.reconcileDraft = reconcileDraft;', context);
const reconcile = context.reconcileDraft;
test('unrelated refresh preserves unsaved edits and adopts remote changes to untouched fields', () => {
 assert.equal(reconcile('수정 중', '기존', '서버 변경'), '수정 중');
 assert.equal(reconcile('기존', '기존', '서버 변경'), '서버 변경');
 assert.deepEqual(reconcile([{ title: '편집 중' }], [{ title: '기존' }], [{ title: '갱신' }]), [{ title: '편집 중' }]);
});
test('confirmed reset replaces draft; edits made during a save are retained', () => {
 assert.equal(reconcile('저장 이후 추가 입력', '기존', '저장된 입력'), '저장 이후 추가 입력');
 assert.equal(reconcile('수정 중', '기존', '기본값', true), '기본값');
});
