import test from 'node:test';
import assert from 'node:assert/strict';
import {createState, transition, announcement, queryParams, addressIntent} from '../../public/state.js';
import {expected, rows} from './oracle.js';

const send = (state, type, payload = {}) => transition(state, {type, ...payload});
const data = options => { const {items, summary} = expected(options); return {items: items.slice(0, 25), summary, page: 1, pageSize: 25, total: items.length, totalPages: Math.ceil(items.length / 25)}; };

test('canonical snapshot survives newer failure and every earlier completion; retry owns changed context', () => {
  let state = send(createState(), 'result:start');
  state = send(state, 'result:success', {token: state.resultOp.token, data: data({})});
  const snapshot = state.result;
  state = send(state, 'intent', {patch: {q: 'Billing'}});
  state = send(state, 'result:start'); const old = state.resultOp.token;
  state = send(state, 'intent', {patch: {q: 'Search', status: ['open']}});
  state = send(state, 'result:start');
  state = send(state, 'result:failure', {token: state.resultOp.token, error: 'Connection refused'});
  for (const type of ['result:success', 'result:failure', 'result:finish']) {
    assert.equal(send(state, type, {token: old, data: data({q: 'Billing'}), error: 'Earlier failure'}), state);
  }
  assert.equal(state.result, snapshot); assert.equal(announcement(state), 'Connection refused');
  state = send(state, 'intent', {patch: {q: 'Notifications'}});
  state = send(state, 'result:start'); const current = state.resultOp.token;
  assert.equal(queryParams(state.intent).get('q'), 'Notifications');
  assert.deepEqual(queryParams(state.intent).getAll('status'), ['open']);
  assert.equal(send(state, 'result:finish', {token: old}), state);
  state = send(state, 'result:success', {token: current, data: data({q: 'Notifications', status: ['open']})});
  assert.deepEqual(state.result.data, data({q: 'Notifications', status: ['open']}));
});

test('detail replacement/failure/retry and closing invalidate old data, errors and cleanup together', () => {
  let state = send(createState(), 'result:start');
  state = send(state, 'result:success', {token: state.resultOp.token, data: data({})});
  const result = state.result, intent = state.intent;
  state = send(state, 'detail:select', {id: rows[0].id}); state = send(state, 'detail:start'); const old = state.detail.token;
  state = send(state, 'detail:select', {id: rows[1].id}); state = send(state, 'detail:start');
  state = send(state, 'detail:failure', {token: state.detail.token, error: 'Connection refused'});
  for (const type of ['detail:success', 'detail:failure', 'detail:finish']) assert.equal(send(state, type, {token: old, data: rows[0], error: 'old'}), state);
  state = send(state, 'detail:start'); assert.equal(state.detail.id, rows[1].id);
  state = send(state, 'detail:success', {token: state.detail.token, data: rows[1]}); assert.deepEqual(state.detail.data, rows[1]);
  const closedToken = state.detail.token;
  state = send(state, 'detail:close');
  for (const type of ['detail:success', 'detail:failure', 'detail:finish']) assert.equal(send(state, type, {token: closedToken, data: rows[1], error: 'old'}), state);
  assert.equal(state.result, result); assert.equal(state.intent, intent); assert.equal(state.detail.id, null);
});

test('canonical address snapshot, newer intent failure and retry reject all navigation-era writers', () => {
  const intent = addressIntent('q=incident&service=Billing&service=Search&page=3&pageSize=50&sort=severity&direction=asc');
  let state = send(createState(), 'address', {intent});
  state = send(state, 'result:start');
  const oracle = expected(intent);
  const accepted = {items: oracle.items.slice(100, 150), summary: oracle.summary, page: 3, pageSize: 50, total: oracle.items.length, totalPages: Math.ceil(oracle.items.length / 50)};
  state = send(state, 'result:success', {token: state.resultOp.token, data: accepted});
  assert.deepEqual(state.result.data, accepted); assert.equal(state.intent.page, 3);
  const snapshot = state.result;
  state = send(state, 'detail:select', {id: accepted.items[0].id}); state = send(state, 'detail:start');
  state = send(state, 'export:start'); state = send(state, 'result:start');
  const tokens = {result: state.resultOp.token, detail: state.detail.token, export: state.exportOp.token};
  state = send(state, 'address', {intent: addressIntent('q=Notifications&page=2')});
  state = send(state, 'result:start'); const navigated = state.resultOp.token;
  state = send(state, 'intent', {patch: {q: 'Uploads'}}); state = send(state, 'result:start');
  state = send(state, 'result:failure', {token: state.resultOp.token, error: 'Connection refused'});
  for (const [operation, token] of Object.entries(tokens)) for (const ending of ['success', 'failure', 'finish']) assert.equal(send(state, `${operation}:${ending}`, {token, data: accepted, error: 'obsolete'}), state);
  for (const ending of ['success', 'failure', 'finish']) assert.equal(send(state, `result:${ending}`, {token: navigated, data: data({q: 'Notifications'}), error: 'obsolete'}), state);
  assert.equal(state.result, snapshot); assert.equal(announcement(state), 'Connection refused');
  state = send(state, 'result:start');
  state = send(state, 'result:success', {token: state.resultOp.token, data: data({...intent, q: 'Uploads'})});
  assert.deepEqual(state.result.data, data({...intent, q: 'Uploads'}));
});
