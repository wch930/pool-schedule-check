import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifySwimProgram,
  parseTimeRange,
  addCalendarDays,
} from '../lib/toronto-api.js';

import {
  getTorontoNow,
  isSessionEligible,
  evaluatePoolStatus,
} from '../public/js/schedule-engine.js';

test('classifySwimProgram accurately distinguishes lane swim subtypes', () => {
  assert.equal(classifySwimProgram('Lane Swim', '7 years and over'), 'lane_general');
  assert.equal(classifySwimProgram('Lane Swim (Men)', '7 years and over'), 'lane_men');
  assert.equal(classifySwimProgram('Lane Swim (Women)', '7 years and over'), 'lane_women');
  assert.equal(
    classifySwimProgram('Lane Swim: Older Adult', '60 years and over'),
    'lane_senior'
  );
  assert.equal(classifySwimProgram('Leisure Swim', '0 years and over'), 'leisure');
  assert.equal(
    classifySwimProgram('Aquatic Fitness: Shallow', '13 years and over'),
    'aquafit'
  );
});

test('parseTimeRange handles AM/PM and noon transitions accurately', () => {
  const morning = parseTimeRange('07:00 AM - 09:15 AM');
  assert.deepEqual(morning, {
    startMinutes: 420,
    endMinutes: 555,
    durationMinutes: 135,
    start24: '07:00',
    end24: '09:15',
  });

  const noon = parseTimeRange('10:45 AM - 01:00 PM');
  assert.deepEqual(noon, {
    startMinutes: 645,
    endMinutes: 780,
    durationMinutes: 135,
    start24: '10:45',
    end24: '13:00',
  });

  const twelvePm = parseTimeRange('12:00 PM - 01:00 PM');
  assert.equal(twelvePm.startMinutes, 720);
  assert.equal(twelvePm.endMinutes, 780);

  assert.equal(addCalendarDays('2026-11-30', 5), '2026-12-05');
});

test('getTorontoNow converts non-Toronto timestamp into America/Toronto calendar & clock', () => {
  // 2026-11-13T21:45:00-08:00 (PST) === 2026-11-14T00:45:00-05:00 (EST Saturday)
  const pstInstant = new Date('2026-11-13T21:45:00-08:00');
  const toronto = getTorontoNow(pstInstant);
  assert.equal(toronto.date, '2026-11-14');
  assert.equal(toronto.time24, '00:45');
  assert.equal(toronto.minutes, 45);
  assert.equal(toronto.weekdayZh, '周六');
});

test('default my_lane filter includes general + men, excludes women and 60+', () => {
  assert.equal(isSessionEligible({ category: 'lane_general' }, 'my_lane'), true);
  assert.equal(isSessionEligible({ category: 'lane_men' }, 'my_lane'), true);
  assert.equal(isSessionEligible({ category: 'lane_women' }, 'my_lane'), false);
  assert.equal(isSessionEligible({ category: 'lane_senior' }, 'my_lane'), false);
  assert.equal(isSessionEligible({ category: 'leisure' }, 'my_lane'), false);
});

test('evaluatePoolStatus detects contiguous Men + General Lane Swim and cross-day next session', () => {
  const mockWellesley = {
    id: 451,
    shortName: 'Wellesley',
    alerts: [],
    weeks: [
      {
        weekIndex: 1,
        startDate: '2026-11-09',
        endDate: '2026-11-15',
        sessions: [
          {
            date: '2026-11-12', // Thursday
            dayOfWeek: 'thursday',
            programTitle: 'Lane Swim (Men)',
            category: 'lane_men',
            timeLabel: '05:45 PM - 07:00 PM',
            start24: '17:45',
            end24: '19:00',
            startMinutes: 1065,
            endMinutes: 1140,
            durationMinutes: 75,
            isCancelled: false,
          },
          {
            date: '2026-11-12', // Thursday immediately following
            dayOfWeek: 'thursday',
            programTitle: 'Lane Swim',
            category: 'lane_general',
            timeLabel: '07:00 PM - 09:00 PM',
            start24: '19:00',
            end24: '21:00',
            startMinutes: 1140,
            endMinutes: 1260,
            durationMinutes: 120,
            isCancelled: false,
          },
          {
            date: '2026-11-13', // Friday morning
            dayOfWeek: 'friday',
            programTitle: 'Lane Swim',
            category: 'lane_general',
            timeLabel: '07:00 AM - 09:15 AM',
            start24: '07:00',
            end24: '09:15',
            startMinutes: 420,
            endMinutes: 555,
            durationMinutes: 135,
            isCancelled: false,
          },
        ],
      },
    ],
  };

  // At 6:00 PM (1080) Thursday under my_lane: open AND contiguous until 9:00 PM (1260)!
  const at6pm = evaluatePoolStatus(mockWellesley, {
    targetDate: '2026-11-12',
    targetMinutes: 1080,
    filterMode: 'my_lane',
  });
  assert.equal(at6pm.state, 'open');
  assert.equal(at6pm.isContiguousChain, true);
  assert.equal(at6pm.contiguousEndMinutes, 1260);
  assert.equal(at6pm.remainingMinutes, 180); // 3 hours left across both sessions

  // At 5:15 PM (1035) Thursday: starting in 30 mins -> 'soon'
  const at515pm = evaluatePoolStatus(mockWellesley, {
    targetDate: '2026-11-12',
    targetMinutes: 1035,
    filterMode: 'my_lane',
  });
  assert.equal(at515pm.state, 'soon');
  assert.equal(at515pm.startsInMinutes, 30);

  // At 9:30 PM (1290) Thursday: closed, next session is Friday 07:00 AM (420)
  const at930pm = evaluatePoolStatus(mockWellesley, {
    targetDate: '2026-11-12',
    targetMinutes: 1290,
    filterMode: 'my_lane',
  });
  assert.equal(at930pm.state, 'closed');
  assert.equal(at930pm.nextSession.date, '2026-11-13');
  assert.equal(at930pm.nextSession.minutesUntilStart, (1440 - 1290) + 420);
});
