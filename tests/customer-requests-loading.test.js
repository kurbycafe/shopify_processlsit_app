import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const source = await fs.readFile(new URL('../app/components/CustomerRequestsManager.jsx', import.meta.url), 'utf8');
const body = source.slice(source.indexOf('const STATUS_LABELS')).replace('export default function', 'function') + '\nglobalThis.component = CustomerRequestsManager;';
const compiled = ts.transpileModule(body, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;
function screen() {
  const state = [], refs = [], dependencies = [], effects = [], loads = [];
  let index = 0, refIndex = 0, effectIndex = 0, fetchIndex = 0;
  const query = { state: 'idle', data: null }, update = { state: 'idle', data: null };
  const load = url => { loads.push(url); query.state = 'loading'; };
  const context = {
    React: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) },
    useState: initial => { const i = index++; if (!(i in state)) state[i] = initial; return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; },
    useRef: initial => refs[refIndex++] ||= { current: initial },
    useMemo: callback => callback(),
    useEffect: (callback, deps) => { const i = effectIndex++; if (!dependencies[i] || deps.some((value, j) => !Object.is(value, dependencies[i][j]))) { dependencies[i] = deps; effects.push(callback); } },
    // React Router returns a new fetcher object when its state/data changes.
    useFetcher: () => fetchIndex++ === 0 ? { ...query, load } : { ...update, submit() {} },
  };
  for (const name of ['Badge','Banner','BlockStack','Button','Card','Divider','EmptyState','InlineStack','Select','Spinner','Text','TextField','Modal']) context[name] = name;
  vm.createContext(context); vm.runInContext(compiled, context);
  const render = () => { index = refIndex = effectIndex = fetchIndex = 0; const tree = context.component(); effects.splice(0).forEach(effect => effect()); return tree; };
  return { render, query, update, loads, state };
}
test('query state changes and replies do not restart the initial request', () => {
  const page = screen(); page.render();
  assert.equal(page.loads.length, 1);
  page.render(); assert.equal(page.loads.length, 1);
  page.query.state = 'idle'; page.query.data = { requests: [], nextCursor: null };
  page.render(); page.render(); assert.equal(page.loads.length, 1);
  page.state[0] = 'CLOSED'; page.render(); assert.equal(page.loads.length, 2);
  assert.match(page.loads[1], /status=CLOSED/);
});
test('a successful update refreshes once, while a failed update does not refetch', () => {
  const page = screen(); page.render();
  page.update.state = 'submitting'; page.render();
  page.update.state = 'idle'; page.update.data = { success: true }; page.render();
  assert.equal(page.loads.length, 2);
  page.render(); assert.equal(page.loads.length, 2);
  page.update.state = 'submitting'; page.render();
  page.update.state = 'idle'; page.update.data = { error: 'Save failed' }; page.render();
  assert.equal(page.loads.length, 2);
});
