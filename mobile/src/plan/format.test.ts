import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dayName, formatLocal } from './format.ts';

test('formats venue-local times without timezone conversion', () => {
  assert.equal(formatLocal('2026-11-10T14:05:00'), 'Tuesday 2:05 PM');
  assert.equal(formatLocal('2026-11-11T11:00:00'), 'Wednesday 11 AM');
  assert.equal(formatLocal('2026-11-12T00:30:00', false), '12:30 AM');
  assert.equal(formatLocal('2026-11-09T12:00:00'), 'Monday 12 PM');
});

test('dayName gives the venue weekday', () => {
  assert.equal(dayName('2026-11-11'), 'Wednesday');
});
