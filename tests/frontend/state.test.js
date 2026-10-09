import test from 'node:test';
import assert from 'node:assert/strict';
import {createState, transition, savedView, queryParams, canPaginate, announcement, addressIntent, normalizeIntent} from '../../public/state.js';
// Completion events are component inputs, not HTTP response fixtures.
const result = (state, page = 1, totalPages = 4) => {
  state = transition(state, {type: 'result:start'});
  return transition(state, {type: 'result:success', token: state.resultOp.token, data: {page, totalPages, total: 80}});
};
test('intent change invalidates success, failure and cleanup while preserving displayed snapshot', () => {
  let s = result(createState()); const snapshot = s.result;
  s = transition(s, {type: 'result:start'}); const old = s.resultOp.token;
  s = transition(s, {type: 'intent', patch: {q: 'billing'}});
  s = transition(s, {type: 'result:start'}); const current = s;
  for (const type of ['result:success', 'result:failure', 'result:finish']) {
    assert.equal(transition(s, {type, token: old, data: {page: 4}, error: 'old failure'}), current);
  }
  assert.equal(s.result, snapshot); assert.equal(canPaginate(s), false);
  assert.match(announcement(s), /Previous results/);
});
test('failure and retry belong to current selections and late cleanup cannot clear newer loading', () => {
  let s = transition(createState(), {type: 'intent', patch: {severity: ['critical'], q: 'new'}});
  s = transition(s, {type: 'result:start'}); const failed = s.resultOp.token;
  s = transition(s, {type: 'result:failure', token: failed, error: 'Try again'});
  assert.equal(announcement(s), 'Try again'); assert.equal(s.intent.q, 'new');
  s = transition(s, {type: 'result:start'});
  assert.equal(queryParams(s.intent).get('q'), 'new');
  assert.equal(transition(s, {type: 'result:finish', token: failed}), s);
  assert.equal(s.resultOp.pending, true); assert.equal(s.resultOp.error, null);
});
test('detail close/reselection invalidate all old writers and preserve result identity', () => {
  let s = result(createState()); const snapshot = s.result, intent = s.intent;
  s = transition(s, {type: 'detail:select', id: 'A'});
  s = transition(s, {type: 'detail:start'}); const old = s.detail.token;
  s = transition(s, {type: 'detail:close'});
  for (const type of ['detail:success', 'detail:failure', 'detail:finish']) assert.equal(transition(s, {type, token: old, data: {}, error: 'old'}), s);
  s = transition(s, {type: 'detail:select', id: 'B'});
  s = transition(s, {type: 'detail:start'});
  for (const type of ['detail:success', 'detail:failure', 'detail:finish']) assert.equal(transition(s, {type, token: old, data: {}, error: 'old'}), s);
  assert.equal(s.detail.pending, true);
  assert.equal(s.result, snapshot); assert.equal(s.intent, intent);
  s = transition(s, {type: 'detail:failure', token: s.detail.token, error: 'B failed'});
  const detailError = announcement(s);
  s = transition(s, {type: 'export:start'});
  s = transition(s, {type: 'export:failure', token: s.exportOp.token, error: 'CSV failed'});
  assert.equal(announcement(s), detailError);
  s = transition(s, {type: 'detail:start'}); assert.equal(s.detail.id, 'B');
});
test('atomic saved view recall resets page and invalidates pending operations', () => {
  let s = result(createState(), 3);
  s = transition(s, {type: 'export:start'}); const exportToken = s.exportOp.token;
  s = transition(s, {type: 'detail:select', id: 'A'});
  s = transition(s, {type: 'detail:start'}); const detailToken = s.detail.token;
  const view = savedView({...s.intent, q: 'saved', service: ['Billing', 'Search'], pageSize: 50, sort: 'severity', direction: 'asc'});
  assert.equal('page' in view, false);
  s = transition(s, {type: 'restore', view: JSON.parse(JSON.stringify(view))});
  assert.equal(s.intent.page, 1); assert.equal(s.intent.pageSize, 50);
  assert.deepEqual(s.intent.service, ['Billing', 'Search']); assert.equal(s.detail.id, null);
  assert.equal(transition(s, {type: 'export:success', token: exportToken}), s);
  assert.equal(transition(s, {type: 'detail:success', token: detailToken, data: {}}), s);
  assert.equal(queryParams(s.intent, {pagination: false}).has('pageSize'), false);
});
test('pagination clamps bounds synchronously, rejects repeated pending/stale transitions and accepts later pages', () => {
  let s = createState(); assert.equal(transition(s, {type: 'page', delta: 1}), s);
  s = result(s); assert.equal(transition(s, {type: 'page', delta: -1}), s);
  for (let page = 2; page <= 4; page++) {
    s = transition(s, {type: 'page', delta: 1}); assert.equal(s.intent.page, page);
    assert.equal(transition(s, {type: 'page', delta: 1}), s);
    s = transition(s, {type: 'result:start'});
    assert.equal(transition(s, {type: 'page', delta: -1}), s);
    s = transition(s, {type: 'result:success', token: s.resultOp.token, data: {page, totalPages: 4, total: 80}});
  }
  assert.equal(transition(s, {type: 'page', delta: 1}), s);
  s = transition(s, {type: 'page', delta: -100}); assert.equal(s.intent.page, 1);
  s = result(s, 1, 0); assert.equal(canPaginate(s), false);
});
test('facet, sort and size changes reset page; query encoding retains repeated facets', () => {
  for (const patch of [{q: 'INC&x'}, {status: ['open', 'resolved']}, {sort: 'severity'}, {pageSize: 50}, {from: '2026-04-01'}]) {
    const s = transition(result(createState(), 3), {type: 'intent', patch}); assert.equal(s.intent.page, 1);
  }
  const params = queryParams({...createState().intent, service: ['Search', 'Billing'], q: 'a&b'});
  assert.deepEqual(params.getAll('service'), ['Billing', 'Search']); assert.equal(params.get('q'), 'a&b');
});
test('result intent changes supersede export failure/cleanup and detail error together', () => {
  let s = result(createState()); s = transition(s, {type: 'export:start'}); const old = s.exportOp.token;
  s = transition(s, {type: 'intent', patch: {status: ['open']}});
  s = transition(s, {type: 'export:start'});
  for (const type of ['export:failure', 'export:finish', 'export:success']) assert.equal(transition(s, {type, token: old, error: 'obsolete'}), s);
  s = transition(s, {type: 'result:start'});
  s = transition(s, {type: 'result:failure', token: s.resultOp.token, error: 'Current query failed'});
  s = transition(s, {type: 'export:failure', token: s.exportOp.token, error: 'CSV failed'});
  assert.equal(announcement(s), 'Current query failed');
});
test('accepted result publishes rows and whole-result metadata atomically and adopts server clamp', () => {
  let s = transition(createState(), {type: 'result:start'});
  const data = {items: ['component row identity'], page: 1, pageSize: 25, totalPages: 1, total: 1, summary: {total: 1, unresolved: 1, highSeverity: 1, openedByDay: []}};
  s = transition(s, {type: 'result:success', token: s.resultOp.token, data});
  assert.equal(s.result.data, data); assert.equal(s.result.data.summary, data.summary);
  assert.equal(s.intent.page, 1); assert.equal(s.result.intent, s.intent);
  assert.equal(s.resultOp.pending, false);
});
test('intent replacement clears failed operation state; later failures and cleanup cannot resurrect it', () => {
  let s = transition(createState(), {type: 'result:start'}); const token = s.resultOp.token;
  s = transition(s, {type: 'result:failure', token, error: 'Earlier error'});
  s = transition(s, {type: 'intent', patch: {q: 'replacement'}});
  assert.equal(s.resultOp.error, null);
  for (const type of ['result:failure', 'result:finish']) assert.equal(transition(s, {type, token, error: 'Earlier error'}), s);
  assert.equal(announcement(s), '');
});
test('export retry invalidates prior writers and retains the current filter and sort', () => {
  let s = transition(createState(), {type: 'intent', patch: {q: 'CSV', sort: 'severity', status: ['open']}});
  s = transition(s, {type: 'export:start'}); const old = s.exportOp.token;
  s = transition(s, {type: 'export:failure', token: old, error: 'Download failed'});
  assert.equal(announcement(s), 'Download failed');
  s = transition(s, {type: 'export:start'});
  assert.equal(s.exportOp.error, null);
  for (const type of ['export:failure', 'export:finish', 'export:success']) assert.equal(transition(s, {type, token: old, error: 'old'}), s);
  assert.equal(queryParams(s.intent, {pagination: false}).get('q'), 'CSV');
  assert.equal(queryParams(s.intent, {pagination: false}).get('sort'), 'severity');
});

test('address codec preserves full normalized intent and safely repairs malformed values', () => {
  const intent = normalizeIntent({q: 'a&b=+?# café 日本語', service: ['Search', 'Billing'], status: ['open', 'resolved'], severity: ['high', 'critical'], from: '2024-02-29', to: '2026-06-29', sort: 'severity', direction: 'asc', pageSize: 50, page: 3});
  assert.deepEqual(addressIntent(queryParams(intent).toString()), intent);
  assert.deepEqual(addressIntent(''), createState().intent);
  const malformed = addressIntent('?q=first&q=second&service=no&service=Billing&from=2026-02-30&to=garbage&sort=no&direction=no&page=1e2&pageSize=050');
  assert.deepEqual(malformed, {...createState().intent, q: 'first', service: ['Billing']});
  for (const search of ['from=2026-06-29&to=2026-04-01', 'from=2025-02-29&to=2026-13-01']) {
    assert.equal(addressIntent(search).from, ''); assert.equal(addressIntent(search).to, '');
  }
  for (const page of ['0', '-1', 'Infinity', '9007199254740992', '01', '2.5']) assert.equal(addressIntent(`page=${page}`).page, 1);
});
test('address restoration preserves page and supersedes all writers through newer failure and retry', () => {
  let s = result(createState()); const snapshot = s.result;
  s = transition(s, {type: 'result:start'});
  s = transition(s, {type: 'detail:select', id: 'A'}); s = transition(s, {type: 'detail:start'});
  s = transition(s, {type: 'export:start'});
  const old = {result: s.resultOp.token, detail: s.detail.token, export: s.exportOp.token};
  s = transition(s, {type: 'address', intent: addressIntent('q=restored&page=3&pageSize=50')});
  assert.equal(s.intent.page, 3); assert.equal(s.detail.id, null); assert.equal(s.result, snapshot);
  s = transition(s, {type: 'result:start'}); const restored = s.resultOp.token;
  s = transition(s, {type: 'intent', patch: {q: 'newer'}});
  s = transition(s, {type: 'result:start'}); const failed = s.resultOp.token;
  s = transition(s, {type: 'result:failure', token: failed, error: 'Current failure'});
  for (const [operation, token] of Object.entries(old)) for (const ending of ['success', 'failure', 'finish']) assert.equal(transition(s, {type: `${operation}:${ending}`, token, data: {page: 99}, error: 'obsolete'}), s);
  for (const ending of ['success', 'failure', 'finish']) assert.equal(transition(s, {type: `result:${ending}`, token: restored, data: {page: 99}, error: 'obsolete'}), s);
  assert.equal(announcement(s), 'Current failure'); assert.equal(s.intent.page, 1);
  s = transition(s, {type: 'result:start'});
  assert.equal(transition(s, {type: 'result:finish', token: failed}), s);
  s = transition(s, {type: 'result:success', token: s.resultOp.token, data: {page: 1, total: 0, totalPages: 0}});
  assert.equal(announcement(s), '0 matching incidents.');
});
