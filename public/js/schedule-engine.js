/**
 * Pure schedule & timezone calculation engine for Downtown Toronto pools.
 * All pool schedules operate in America/Toronto (EST/EDT).
 */

export const TORONTO_TZ = 'America/Toronto';

export const FILTER_MODES = {
  my_lane: {
    id: 'my_lane',
    label: '我的可游 (通用 + Men)',
    shortLabel: '通用 + Men',
    categories: new Set(['lane_general', 'lane_men']),
  },
  general_only: {
    id: 'general_only',
    label: '仅通用 Lane Swim',
    shortLabel: '仅通用',
    categories: new Set(['lane_general']),
  },
  all_lane: {
    id: 'all_lane',
    label: '全部泳道 (含 Women / 60+)',
    shortLabel: '全部 Lane',
    categories: new Set([
      'lane_general',
      'lane_men',
      'lane_women',
      'lane_senior',
      'lane_youth',
    ]),
  },
  all_swim: {
    id: 'all_swim',
    label: '全部项目 (含 Leisure / 水中健身)',
    shortLabel: '全部项目',
    categories: new Set([
      'lane_general',
      'lane_men',
      'lane_women',
      'lane_senior',
      'lane_youth',
      'leisure',
      'aquafit',
      'lessons',
    ]),
  },
};

export const CATEGORY_META = {
  lane_general: { label: '通用泳道', tagClass: 'tag-lane_general', blockClass: 'cat-lane_general' },
  lane_men: { label: '男士专场 Men', tagClass: 'tag-lane_men', blockClass: 'cat-lane_men' },
  lane_women: { label: '女士专场 Women', tagClass: 'tag-lane_women', blockClass: 'cat-lane_women' },
  lane_senior: { label: '60+ 长者专场', tagClass: 'tag-lane_senior', blockClass: 'cat-lane_senior' },
  lane_youth: { label: '青少年泳道', tagClass: 'tag-other', blockClass: 'cat-leisure' },
  leisure: { label: '休闲游 Leisure', tagClass: 'tag-other', blockClass: 'cat-leisure' },
  aquafit: { label: '水中健身 Aquafit', tagClass: 'tag-other', blockClass: 'cat-aquafit' },
  lessons: { label: 'Drop-in 课程', tagClass: 'tag-other', blockClass: 'cat-lessons' },
};

const WEEKDAY_ZH_BY_INDEX = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const WEEKDAY_EN_BY_INDEX = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Extract current date & time components in America/Toronto regardless of viewer's local OS timezone.
 */
export function getTorontoNow(dateObj = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TORONTO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
  });

  const parts = {};
  for (const part of formatter.formatToParts(dateObj)) {
    if (part.type !== 'literal') {
      parts[part.type] = part.value;
    }
  }

  const year = parts.year;
  const month = parts.month;
  const day = parts.day;
  const hour = parseInt(parts.hour, 10) % 24;
  const minute = parseInt(parts.minute, 10);
  const dateStr = `${year}-${month}-${day}`;
  const minutes = hour * 60 + minute;
  const time24 = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

  const dayIndex = getDayOfWeekIndex(dateStr);

  return {
    date: dateStr,
    minutes,
    time24,
    time12: formatMinutesTo12h(minutes),
    tzAbbr: parts.timeZoneName || 'ET',
    weekdayIndex: dayIndex,
    weekdayZh: WEEKDAY_ZH_BY_INDEX[dayIndex],
    weekdayEn: WEEKDAY_EN_BY_INDEX[dayIndex],
  };
}

/**
 * Return 0 (Sun) .. 6 (Sat) for YYYY-MM-DD in pure calendar math.
 */
export function getDayOfWeekIndex(yyyyMmDd) {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(yyyyMmDd, delta) {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export function diffCalendarDays(fromDate, toDate) {
  const [y1, m1, d1] = fromDate.split('-').map(Number);
  const [y2, m2, d2] = toDate.split('-').map(Number);
  const ms1 = Date.UTC(y1, m1 - 1, d1);
  const ms2 = Date.UTC(y2, m2 - 1, d2);
  return Math.round((ms2 - ms1) / 86400000);
}

export function formatShortDate(yyyyMmDd) {
  const [, m, d] = yyyyMmDd.split('-');
  return `${m}/${d}`;
}

export function formatRelativeDayLabel(targetDate, referenceDate) {
  const diff = diffCalendarDays(referenceDate, targetDate);
  const wd = WEEKDAY_ZH_BY_INDEX[getDayOfWeekIndex(targetDate)];
  if (diff === 0) return `今天 (${wd})`;
  if (diff === 1) return `明天 (${wd})`;
  if (diff === 2) return `后天 (${wd})`;
  return `${formatShortDate(targetDate)} ${wd}`;
}

export function formatMinutesTo12h(totalMins) {
  const clamped = ((totalMins % 1440) + 1440) % 1440;
  const h24 = Math.floor(clamped / 60);
  const m = clamped % 60;
  const mer = h24 >= 12 ? 'PM' : 'AM';
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${mer}`;
}

export function formatMinutesTo24h(totalMins) {
  const clamped = ((totalMins % 1440) + 1440) % 1440;
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function formatDuration(mins) {
  const rounded = Math.max(0, Math.round(mins));
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

export function isSessionEligible(session, filterMode = 'my_lane') {
  const mode = FILTER_MODES[filterMode] || FILTER_MODES.my_lane;
  return mode.categories.has(session.category);
}

/**
 * Flatten and deduplicate all sessions across a pool's published weeks.
 */
export function getAllPoolSessions(pool) {
  const seen = new Set();
  const list = [];
  for (const wk of pool.weeks || []) {
    for (const s of wk.sessions || []) {
      const key = `${s.date}|${s.programTitle}|${s.startMinutes}|${s.endMinutes}`;
      if (!seen.has(key)) {
        seen.add(key);
        list.push(s);
      }
    }
  }
  list.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    if (a.startMinutes !== b.startMinutes) return a.startMinutes - b.startMinutes;
    return a.endMinutes - b.endMinutes;
  });
  return list;
}

/**
 * Given sorted active eligible sessions on a single day, compute contiguous end time
 * if a session connects directly (gap <= 5 minutes) into another eligible session
 * (e.g. Wellesley Thu 5:45-7:00 PM Lane Swim (Men) + 7:00-9:00 PM Lane Swim).
 */
export function findContiguousEnd(eligibleActiveDaySessions, startSession) {
  let currentEnd = startSession.endMinutes;
  let mergedCount = 1;
  for (const s of eligibleActiveDaySessions) {
    if (s === startSession) continue;
    if (s.startMinutes <= currentEnd + 5 && s.endMinutes > currentEnd) {
      currentEnd = s.endMinutes;
      mergedCount += 1;
    }
  }
  return {
    contiguousEndMinutes: currentEnd,
    contiguousEnd12: formatMinutesTo12h(currentEnd),
    contiguousEnd24: formatMinutesTo24h(currentEnd),
    isContiguousChain: mergedCount > 1 && currentEnd > startSession.endMinutes,
  };
}

/**
 * Evaluate a single pool's status at (targetDate, targetMinutes) under filterMode.
 */
export function evaluatePoolStatus(
  pool,
  { targetDate, targetMinutes, filterMode = 'my_lane', soonThresholdMinutes = 60 }
) {
  const allSessions = getAllPoolSessions(pool);
  const daySessions = allSessions.filter((s) => s.date === targetDate);

  const eligibleDayActive = daySessions.filter(
    (s) => !s.isCancelled && isSessionEligible(s, filterMode)
  );

  // Check if pool has an active facility-level pool closure alert
  const hasPoolClosureAlert = (pool.alerts || []).some(
    (a) => a.severity === 'closure' && a.isPoolRelated
  );

  // 1. Currently open session?
  const activeMatches = eligibleDayActive.filter(
    (s) => s.startMinutes <= targetMinutes && targetMinutes < s.endMinutes
  );

  if (!hasPoolClosureAlert && activeMatches.length > 0) {
    // Prefer general lane swim if overlapping, or longest remaining
    activeMatches.sort((a, b) => b.endMinutes - a.endMinutes);
    const current = activeMatches[0];
    const chain = findContiguousEnd(eligibleDayActive, current);
    const remainingMinutes = chain.contiguousEndMinutes - targetMinutes;
    const totalSpan = Math.max(1, chain.contiguousEndMinutes - current.startMinutes);
    const elapsed = Math.max(0, targetMinutes - current.startMinutes);
    const progressPct = Math.min(100, Math.round((elapsed / totalSpan) * 100));

    return {
      state: 'open',
      currentSession: current,
      remainingMinutes,
      slotRemainingMinutes: current.endMinutes - targetMinutes,
      contiguousEndMinutes: chain.contiguousEndMinutes,
      contiguousEnd12: chain.contiguousEnd12,
      isContiguousChain: chain.isContiguousChain,
      progressPct,
      nextSession: findNextFutureSession(allSessions, targetDate, chain.contiguousEndMinutes, filterMode),
      daySessions,
      eligibleDayCount: eligibleDayActive.length,
      hasPoolClosureAlert,
    };
  }

  // 2. Find next eligible session (later on targetDate or subsequent days)
  const nextInfo = findNextFutureSession(allSessions, targetDate, targetMinutes, filterMode);

  if (
    !hasPoolClosureAlert &&
    nextInfo &&
    nextInfo.dayOffset === 0 &&
    nextInfo.minutesUntilStart <= soonThresholdMinutes
  ) {
    const chain = findContiguousEnd(eligibleDayActive, nextInfo.session);
    return {
      state: 'soon',
      currentSession: null,
      startsInMinutes: nextInfo.minutesUntilStart,
      nextSession: {
        ...nextInfo,
        contiguousEnd12: chain.contiguousEnd12,
        isContiguousChain: chain.isContiguousChain,
      },
      daySessions,
      eligibleDayCount: eligibleDayActive.length,
      hasPoolClosureAlert,
    };
  }

  return {
    state: 'closed',
    currentSession: null,
    nextSession: hasPoolClosureAlert ? null : nextInfo,
    daySessions,
    eligibleDayCount: eligibleDayActive.length,
    hasPoolClosureAlert,
  };
}

function findNextFutureSession(allSessions, fromDate, fromMinutes, filterMode) {
  for (const s of allSessions) {
    if (s.isCancelled || !isSessionEligible(s, filterMode)) continue;
    if (s.date < fromDate) continue;
    if (s.date === fromDate && s.startMinutes <= fromMinutes) continue;

    const dayOffset = diffCalendarDays(fromDate, s.date);
    const minutesUntilStart = dayOffset * 1440 + s.startMinutes - fromMinutes;

    return {
      session: s,
      date: s.date,
      dayOffset,
      dayLabel: formatRelativeDayLabel(s.date, fromDate),
      minutesUntilStart,
    };
  }
  return null;
}
