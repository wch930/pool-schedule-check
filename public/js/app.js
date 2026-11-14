import {
  FILTER_MODES,
  CATEGORY_META,
  getTorontoNow,
  addDays,
  getDayOfWeekIndex,
  formatShortDate,
  formatRelativeDayLabel,
  formatMinutesTo12h,
  formatMinutesTo24h,
  formatDuration,
  isSessionEligible,
  evaluatePoolStatus,
  findContiguousEnd,
} from './schedule-engine.js';

const TIMELINE_START_MIN = 6 * 60; // 06:00
const TIMELINE_END_MIN = 22 * 60; // 22:00
const TIMELINE_SPAN_MIN = TIMELINE_END_MIN - TIMELINE_START_MIN; // 960 mins

const WEEKDAY_HEADERS = [
  { key: 'monday', zh: '周一', en: 'Mon', offset: 0 },
  { key: 'tuesday', zh: '周二', en: 'Tue', offset: 1 },
  { key: 'wednesday', zh: '周三', en: 'Wed', offset: 2 },
  { key: 'thursday', zh: '周四', en: 'Thu', offset: 3 },
  { key: 'friday', zh: '周五', en: 'Fri', offset: 4 },
  { key: 'saturday', zh: '周六', en: 'Sat', offset: 5 },
  { key: 'sunday', zh: '周日', en: 'Sun', offset: 6 },
];

const WEEKDAY_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const state = {
  payload: null,
  loading: true,
  error: null,
  filterMode: loadSavedFilter(),
  selectedWeekIdx: 0,
  selectedDate: null,
  timeMode: 'live', // 'live' | 'custom'
  customMinutes: 18 * 60,
  weeklyPoolFilter: 'all', // 'all' | '451' | '2012' | '272'
  expandedOtherPools: new Set(), // pool IDs with non-eligible sessions expanded
  selectedTimelineSession: null, // detail bar highlight
};

function loadSavedFilter() {
  try {
    const saved = localStorage.getItem('to_pool_filter_mode');
    if (saved && FILTER_MODES[saved]) return saved;
  } catch {
    // ignore storage restriction
  }
  return 'my_lane';
}

function saveFilter(mode) {
  try {
    localStorage.setItem('to_pool_filter_mode', mode);
  } catch {
    // ignore
  }
}

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getEffectiveQueryMoment() {
  const now = getTorontoNow();
  const targetDate = state.selectedDate || now.date;
  const targetMinutes = state.timeMode === 'live' ? now.minutes : state.customMinutes;
  const isToday = targetDate === now.date;
  const isFutureDate = targetDate > now.date;
  return {
    now,
    targetDate,
    targetMinutes,
    isToday,
    isFutureDate,
  };
}

/**
 * Fetch live pool data from /api/pools
 */
async function loadPoolsData({ forceRefresh = false } = {}) {
  const refreshBtn = document.getElementById('btn-refresh-data');
  const refreshLabel = document.getElementById('refresh-btn-label');
  const errorBanner = document.getElementById('error-banner');

  state.loading = true;
  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.classList.add('is-spinning');
  }
  if (refreshLabel && forceRefresh) {
    refreshLabel.textContent = '同步中...';
  }

  try {
    const url = forceRefresh ? './api/pools?refresh=1' : './api/pools';
    let res = await fetch(url, { headers: { Accept: 'application/json' } });
    const contentType = res.headers.get('content-type') || '';

    // Graceful fallback when hosted on static-only preview (e.g. GitHub Pages)
    if (!res.ok || !contentType.includes('application/json')) {
      res = await fetch(`./data/pools.json?_=${Date.now()}`, {
        headers: { Accept: 'application/json' },
      });
    }

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();
    state.payload = data;
    state.error = null;
    if (errorBanner) errorBanner.hidden = true;

    alignInitialDateAndWeek(data);
    renderAll();
  } catch (err) {
    state.error = err?.message || '网络请求失败';
    if (errorBanner) {
      errorBanner.hidden = false;
      const msgEl = document.getElementById('error-message');
      if (msgEl) {
        msgEl.textContent = `无法获取官网实时数据 (${state.error})，请检查连接后重试。`;
      }
    }
  } finally {
    state.loading = false;
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.classList.remove('is-spinning');
    }
    if (refreshLabel) {
      refreshLabel.textContent = '同步官网';
    }
  }
}

function alignInitialDateAndWeek(data) {
  const now = getTorontoNow();
  const refWeeks = data?.pools?.[0]?.weeks || [];
  const params = new URLSearchParams(window.location.search);
  const urlDate = params.get('date');
  const urlTime = params.get('time');

  if (!state.selectedDate) {
    state.selectedDate =
      urlDate && /^\d{4}-\d{2}-\d{2}$/.test(urlDate) ? urlDate : now.date;
  }

  if (urlTime && /^\d{1,2}:\d{2}$/.test(urlTime) && state.timeMode === 'live') {
    const [h, m] = urlTime.split(':').map(Number);
    if (h >= 0 && h < 24 && m >= 0 && m < 60) {
      state.timeMode = 'custom';
      state.customMinutes = h * 60 + m;
    }
  }

  const matchingIdx = refWeeks.findIndex(
    (w) => state.selectedDate >= w.startDate && state.selectedDate <= w.endDate
  );
  if (matchingIdx >= 0) {
    state.selectedWeekIdx = matchingIdx;
  } else if (refWeeks.length > 0) {
    state.selectedWeekIdx = 0;
    state.selectedDate = refWeeks[0].startDate;
  }
}

function getAvailableWeeks() {
  return state.payload?.pools?.[0]?.weeks || [];
}

/* ==========================================================================
   Render Orchestrator
   ========================================================================== */
function renderAll() {
  const moment = getEffectiveQueryMoment();
  renderClockAndControls(moment);

  if (!state.payload?.pools) return;

  const evaluations = state.payload.pools.map((pool) => ({
    pool,
    evalResult: evaluatePoolStatus(pool, {
      targetDate: moment.targetDate,
      targetMinutes: moment.targetMinutes,
      filterMode: state.filterMode,
    }),
  }));

  renderVerdictBanner(evaluations, moment);
  renderWeekAndDayControls(moment);
  renderTimeline(evaluations, moment);
  renderPoolCards(evaluations, moment);
  renderWeeklyTable(moment);
  renderSyncTimestamp();
}

function renderClockAndControls(moment) {
  const { now, targetDate, targetMinutes } = moment;
  const clockText = document.getElementById('toronto-clock-text');
  const clockDot = document.getElementById('clock-mode-dot');

  if (clockText) {
    if (state.timeMode === 'live' && targetDate === now.date) {
      clockText.textContent = `多伦多 ${now.tzAbbr} · ${now.weekdayZh} ${now.time24}`;
      clockDot?.classList.remove('is-custom-time');
    } else {
      const relLabel = formatRelativeDayLabel(targetDate, now.date);
      clockText.textContent = `预览：${relLabel} ${formatMinutesTo24h(targetMinutes)} (当前 ${now.time24})`;
      clockDot?.classList.add('is-custom-time');
    }
  }

  // Filter buttons active state
  document.querySelectorAll('#filter-pills-group .filter-pill').forEach((btn) => {
    const isAct = btn.dataset.filter === state.filterMode;
    btn.classList.toggle('is-active', isAct);
    btn.setAttribute('aria-checked', String(isAct));
  });

  // Time preset buttons active state
  const liveBtn = document.getElementById('btn-time-live');
  if (liveBtn) {
    liveBtn.classList.toggle(
      'is-active',
      state.timeMode === 'live' && targetDate === now.date
    );
  }

  document.querySelectorAll('.time-preset-btn[data-minutes]').forEach((btn) => {
    const mins = Number(btn.dataset.minutes);
    btn.classList.toggle(
      'is-active',
      state.timeMode === 'custom' && state.customMinutes === mins
    );
  });

  const timeInput = document.getElementById('input-custom-time');
  if (timeInput) {
    timeInput.value = formatMinutesTo24h(targetMinutes);
    timeInput.classList.toggle('is-active', state.timeMode === 'custom');
  }
}

function renderWeekAndDayControls(moment) {
  const weeks = getAvailableWeeks();
  const weekSelect = document.getElementById('select-week');
  if (weekSelect && weeks.length > 0) {
    weekSelect.innerHTML = weeks
      .map((wk, idx) => {
        const isCurrentWk =
          moment.now.date >= wk.startDate && moment.now.date <= wk.endDate;
        const prefix = isCurrentWk ? '本周' : `第 ${idx + 1} 周`;
        const label = `${prefix} (${formatShortDate(wk.startDate)} – ${formatShortDate(wk.endDate)})`;
        return `<option value="${idx}" ${idx === state.selectedWeekIdx ? 'selected' : ''}>${escapeHtml(label)}</option>`;
      })
      .join('');
  }

  const activeWeek = weeks[state.selectedWeekIdx];
  const dayStrip = document.getElementById('day-selector-strip');
  if (!dayStrip || !activeWeek) return;

  dayStrip.innerHTML = WEEKDAY_HEADERS.map((d) => {
    const dateStr = addDays(activeWeek.startDate, d.offset);
    const isToday = dateStr === moment.now.date;
    const isSelected = dateStr === moment.targetDate;
    const dayTag = isToday ? '今天' : d.zh;
    return `
      <button
        type="button"
        id="day-btn-${dateStr}"
        class="day-btn ${isSelected ? 'is-active' : ''} ${isToday ? 'is-today' : ''}"
        data-date="${dateStr}"
      >
        <span>${dayTag}</span>
        <span class="day-date">${formatShortDate(dateStr)}</span>
      </button>
    `;
  }).join('');
}

/* ==========================================================================
   Instant Verdict Banner
   ========================================================================== */
function renderVerdictBanner(evaluations, moment) {
  const banner = document.getElementById('live-verdict-banner');
  const headline = document.getElementById('verdict-headline');
  const subtext = document.getElementById('verdict-subtext');
  const chipsContainer = document.getElementById('verdict-chips');
  if (!banner || !headline || !subtext || !chipsContainer) return;

  const openPools = evaluations.filter((e) => e.evalResult.state === 'open');
  const soonPools = evaluations.filter((e) => e.evalResult.state === 'soon');

  const isLiveNow = state.timeMode === 'live' && moment.isToday;
  const momentPrefix = isLiveNow
    ? '当前时刻'
    : `${formatRelativeDayLabel(moment.targetDate, moment.now.date)} ${formatMinutesTo12h(moment.targetMinutes)}`;

  const modeLabel = FILTER_MODES[state.filterMode]?.shortLabel || 'Lane Swim';

  banner.classList.remove('state-open', 'state-soon');

  if (openPools.length > 0) {
    banner.classList.add('state-open');
    const names = openPools.map((p) => p.pool.shortName).join('、');
    headline.textContent = isLiveNow
      ? `现在有 ${openPools.length} 个泳馆正在开放可游 (${names})`
      : `${momentPrefix} · 有 ${openPools.length} 个泳馆开放可游 (${names})`;

    subtext.textContent = `筛选模式：${FILTER_MODES[state.filterMode].label} · 点击右侧场馆卡片直达详情`;

    chipsContainer.innerHTML = openPools
      .map(({ pool, evalResult }) => {
        const endText = evalResult.contiguousEnd12;
        const rem = formatDuration(evalResult.remainingMinutes);
        return `
          <button type="button" class="verdict-chip chip-open" data-scroll-pool="${pool.id}">
            <span>${escapeHtml(pool.shortName)}</span>
            <span class="tabular">剩 ${rem} (至 ${endText})</span>
          </button>
        `;
      })
      .join('');
    return;
  }

  if (soonPools.length > 0) {
    banner.classList.add('state-soon');
    soonPools.sort(
      (a, b) => a.evalResult.startsInMinutes - b.evalResult.startsInMinutes
    );
    const first = soonPools[0];
    headline.textContent = `${momentPrefix}暂无进行中场次 · ${first.pool.shortName} 将在 ${formatDuration(first.evalResult.startsInMinutes)}后开放`;
    subtext.textContent = `${first.evalResult.nextSession.session.programTitle} (${first.evalResult.nextSession.session.timeLabel}) · 筛选：${modeLabel}`;

    chipsContainer.innerHTML = soonPools
      .map(({ pool, evalResult }) => {
        return `
          <button type="button" class="verdict-chip chip-soon" data-scroll-pool="${pool.id}">
            <span>${escapeHtml(pool.shortName)}</span>
            <span class="tabular">${formatDuration(evalResult.startsInMinutes)}后 (${evalResult.nextSession.session.start24})</span>
          </button>
        `;
      })
      .join('');
    return;
  }

  // Otherwise: find earliest upcoming eligible session across all 3 pools
  const upcomingCandidates = evaluations
    .filter((e) => e.evalResult.nextSession)
    .map((e) => ({
      pool: e.pool,
      next: e.evalResult.nextSession,
    }))
    .sort((a, b) => a.next.minutesUntilStart - b.next.minutesUntilStart);

  if (upcomingCandidates.length > 0) {
    const best = upcomingCandidates[0];
    const relDay = formatRelativeDayLabel(best.next.date, moment.now.date);
    headline.textContent = `${momentPrefix}暂未开放 · 下一场可游：${best.pool.shortName} (${relDay} ${best.next.session.start24})`;
    subtext.textContent = `${best.next.session.programTitle} · ${best.next.session.timeLabel}（距查询时刻 ${formatDuration(best.next.minutesUntilStart)}）`;

    chipsContainer.innerHTML = upcomingCandidates
      .map(({ pool, next }) => {
        const dLabel =
          next.date === moment.targetDate
            ? `今日 ${next.session.start24}`
            : `${formatShortDate(next.date)} ${WEEKDAY_ZH[getDayOfWeekIndex(next.date)]} ${next.session.start24}`;
        return `
          <button type="button" class="verdict-chip" data-scroll-pool="${pool.id}">
            <span>${escapeHtml(pool.shortName)}</span>
            <span class="tabular">下场 ${dLabel}</span>
          </button>
        `;
      })
      .join('');
  } else {
    headline.textContent = `${momentPrefix}暂无匹配的排期数据`;
    subtext.textContent = '可尝试切换上方周次或放宽场次筛选条件';
    chipsContainer.innerHTML = '';
  }
}

/* ==========================================================================
   Unified 3-Pool Visual Timeline (06:00 - 22:00)
   ========================================================================== */
function renderTimeline(evaluations, moment) {
  const container = document.getElementById('timeline-container');
  const hintEl = document.getElementById('timeline-date-hint');
  if (!container) return;

  const dayLabel = formatRelativeDayLabel(moment.targetDate, moment.now.date);
  if (hintEl) {
    hintEl.textContent = `${dayLabel} · 06:00 – 22:00 · 点击时间轴任意时刻可快速定位谁在开放`;
  }

  // Axis ticks every 2 hours from 06:00 to 22:00 (06:00, 12:00, 18:00, 22:00 on narrow mobile)
  const ticks = [];
  for (let h = 6; h <= 22; h += 2) {
    const pct = (((h * 60 - TIMELINE_START_MIN) / TIMELINE_SPAN_MIN) * 100).toFixed(2);
    const showOnMobile = h === 6 || h === 12 || h === 17 + 1 || h === 22;
    const hideMobile = showOnMobile ? '' : 'hide-mobile';
    ticks.push(
      `<span class="axis-tick ${hideMobile}" style="left:${pct}%">${String(h).padStart(2, '0')}:00</span>`
    );
  }

  // Vertical hour guide lines inside tracks
  const guides = [];
  for (let h = 8; h < 22; h += 2) {
    const pct = (((h * 60 - TIMELINE_START_MIN) / TIMELINE_SPAN_MIN) * 100).toFixed(2);
    guides.push(`<span class="lane-hour-guide" style="left:${pct}%"></span>`);
  }
  const guidesHtml = guides.join('');

  // Marker position if targetMinutes within 06:00..22:00
  const showMarker =
    moment.targetMinutes >= TIMELINE_START_MIN &&
    moment.targetMinutes <= TIMELINE_END_MIN;
  const markerPct = showMarker
    ? (((moment.targetMinutes - TIMELINE_START_MIN) / TIMELINE_SPAN_MIN) * 100).toFixed(2)
    : 0;
  const isLiveNow = state.timeMode === 'live' && moment.isToday;
  const markerBadgeText = isLiveNow
    ? `NOW ${formatMinutesTo24h(moment.targetMinutes)}`
    : `${formatMinutesTo24h(moment.targetMinutes)}`;

  const lanesHtml = evaluations
    .map(({ pool, evalResult }, idx) => {
      // On timeline: show lane swim categories by default (dimming non-eligible ones),
      // and include leisure/aquafit only when filterMode === 'all_swim' so tot-pool sessions
      // never obscure 25m lap pool sessions.
      const timelineSessions = evalResult.daySessions.filter((s) => {
        if (state.filterMode === 'all_swim') return true;
        return s.category.startsWith('lane_');
      });

      // Draw non-eligible behind eligible
      const sortedForDraw = [...timelineSessions].sort((a, b) => {
        const ea = isSessionEligible(a, state.filterMode) ? 1 : 0;
        const eb = isSessionEligible(b, state.filterMode) ? 1 : 0;
        return ea - eb;
      });

      const blocksHtml = sortedForDraw
        .map((s) => {
          const clampedStart = Math.max(TIMELINE_START_MIN, s.startMinutes);
          const clampedEnd = Math.min(TIMELINE_END_MIN, s.endMinutes);
          if (clampedEnd <= clampedStart) return '';

          const leftPct = (
            ((clampedStart - TIMELINE_START_MIN) / TIMELINE_SPAN_MIN) *
            100
          ).toFixed(2);
          const widthPct = (
            ((clampedEnd - clampedStart) / TIMELINE_SPAN_MIN) *
            100
          ).toFixed(2);

          const eligible = isSessionEligible(s, state.filterMode);
          const isCurrent =
            eligible &&
            !s.isCancelled &&
            s.startMinutes <= moment.targetMinutes &&
            moment.targetMinutes < s.endMinutes;
          const catMeta = CATEGORY_META[s.category] || CATEGORY_META.leisure;

          const shortSpan = s.endMinutes - s.startMinutes < 70;
          const blockLabel = shortSpan
            ? s.start24
            : `${s.start24}–${s.end24}`;

          return `
            <div
              class="lane-block ${catMeta.blockClass} ${!eligible ? 'is-dimmed' : ''} ${s.isCancelled ? 'is-cancelled' : ''} ${isCurrent ? 'is-active-now' : ''}"
              style="left:${leftPct}%; width:${widthPct}%"
              title="${escapeHtml(`${pool.shortName} · ${s.programTitle} (${s.timeLabel})`)}"
              data-pool-id="${pool.id}"
              data-prog="${escapeHtml(s.programTitle)}"
              data-time="${escapeHtml(s.timeLabel)}"
              data-cat="${escapeHtml(catMeta.label)}"
              data-eligible="${eligible ? '1' : '0'}"
            >
              ${escapeHtml(blockLabel)}
            </div>
          `;
        })
        .join('');

      const markerHtml = showMarker
        ? `
          <div class="timeline-now-marker ${isLiveNow ? '' : 'is-query'}" style="left:${markerPct}%">
            ${idx === 0 ? `<span class="timeline-now-badge">${markerBadgeText}</span>` : ''}
          </div>
        `
        : '';

      const freeBadge = pool.isFreeCentre ? '免费' : '付费';

      return `
        <div class="timeline-lane-row">
          <div class="lane-pool-meta">
            <span class="lane-pool-name">${escapeHtml(pool.shortName)}</span>
            <span class="lane-pool-sub">${freeBadge} · 今日 ${evalResult.eligibleDayCount} 场可游</span>
          </div>
          <div class="lane-track" data-timeline-scrub="1">
            ${guidesHtml}
            ${blocksHtml}
            ${markerHtml}
          </div>
        </div>
      `;
    })
    .join('');

  const detailHtml = state.selectedTimelineSession
    ? `
      <div class="timeline-tooltip">
        <span>
          <strong>${escapeHtml(state.selectedTimelineSession.poolName)}</strong> ·
          ${escapeHtml(state.selectedTimelineSession.prog)} (${escapeHtml(state.selectedTimelineSession.cat)})
        </span>
        <span class="tabular">${escapeHtml(state.selectedTimelineSession.time)}</span>
      </div>
    `
    : '';

  container.innerHTML = `
    <div class="timeline-grid">
      <div class="timeline-axis-row">
        <span class="timeline-axis-label">场馆 / 时刻</span>
        <div class="timeline-axis-track" data-timeline-scrub="1">
          ${ticks.join('')}
        </div>
      </div>
      ${lanesHtml}
    </div>
    ${detailHtml}
  `;
}

/* ==========================================================================
   Three-Pool Cards
   ========================================================================== */
function renderPoolCards(evaluations, moment) {
  const grid = document.getElementById('pool-cards-grid');
  if (!grid) return;

  grid.innerHTML = evaluations
    .map(({ pool, evalResult }) => renderSinglePoolCard(pool, evalResult, moment))
    .join('');
}

function renderSinglePoolCard(pool, evalResult, moment) {
  const { state: openState, currentSession, nextSession, daySessions } = evalResult;

  // Status badge
  let badgeClass = 'badge-closed';
  let badgeText = '当前未开放';
  let cardStateClass = '';

  if (evalResult.hasPoolClosureAlert) {
    badgeClass = 'badge-closed';
    badgeText = '泳池临时关闭';
  } else if (openState === 'open') {
    badgeClass = 'badge-open';
    badgeText = '正在开放 OPEN';
    cardStateClass = 'is-open';
  } else if (openState === 'soon') {
    badgeClass = 'badge-soon';
    badgeText = `${formatDuration(evalResult.startsInMinutes)}后开放`;
    cardStateClass = 'is-soon';
  }

  // Callout block (Active session progress OR Next eligible session)
  let calloutHtml = '';
  if (openState === 'open' && currentSession) {
    const chainNote = evalResult.isContiguousChain
      ? `（含连场可游至 ${evalResult.contiguousEnd12}）`
      : `（${formatMinutesTo12h(currentSession.endMinutes)} 结束）`;

    calloutHtml = `
      <div class="pool-callout callout-open">
        <div class="callout-headline">
          <span>${escapeHtml(currentSession.programTitle)}</span>
          <span class="tabular">还剩 ${formatDuration(evalResult.remainingMinutes)}</span>
        </div>
        <div class="callout-detail tabular">
          ${escapeHtml(currentSession.timeLabel)} ${escapeHtml(chainNote)}
        </div>
        <div class="progress-track" aria-hidden="true">
          <div class="progress-fill" style="width:${evalResult.progressPct}%"></div>
        </div>
      </div>
    `;
  } else if (openState === 'soon' && nextSession) {
    const s = nextSession.session;
    const chainText = nextSession.isContiguousChain
      ? ` · 可连游至 ${nextSession.contiguousEnd12}`
      : '';
    calloutHtml = `
      <div class="pool-callout callout-soon">
        <div class="callout-headline">
          <span>即将开始 · ${escapeHtml(s.programTitle)}</span>
          <span class="tabular">${formatDuration(evalResult.startsInMinutes)}后</span>
        </div>
        <div class="callout-detail tabular">
          ${escapeHtml(s.timeLabel)}${escapeHtml(chainText)}
        </div>
      </div>
    `;
  } else if (nextSession) {
    const s = nextSession.session;
    const dayPrefix =
      nextSession.date === moment.targetDate
        ? '今日稍晚'
        : formatRelativeDayLabel(nextSession.date, moment.now.date);
    calloutHtml = `
      <div class="pool-callout">
        <div class="callout-headline">
          <span>下一场可游 · ${escapeHtml(dayPrefix)}</span>
          <span class="tabular">${escapeHtml(s.start24)}</span>
        </div>
        <div class="callout-detail tabular">
          ${escapeHtml(s.programTitle)} · ${escapeHtml(s.timeLabel)}
        </div>
      </div>
    `;
  } else {
    calloutHtml = `
      <div class="pool-callout">
        <div class="callout-headline">
          <span>暂无后续匹配场次</span>
        </div>
        <div class="callout-detail">可切换筛选条件或查看官网详情</div>
      </div>
    `;
  }

  // Official Alerts
  const alertsHtml =
    Array.isArray(pool.alerts) && pool.alerts.length > 0
      ? `
        <div class="pool-alerts">
          ${pool.alerts
            .map(
              (a) => `
                <div class="alert-item severity-${a.severity}">
                  <span class="alert-title">
                    ${a.severity === 'closure' ? '闭馆通知' : '设施维护提醒'} · ${escapeHtml(a.category)}
                  </span>
                  <span>${escapeHtml(a.comments || a.reason)}</span>
                </div>
              `
            )
            .join('')}
        </div>
      `
      : '';

  // Day's sessions split into eligible vs other
  const eligibleSessions = daySessions.filter((s) =>
    isSessionEligible(s, state.filterMode)
  );
  const otherSessions = daySessions.filter(
    (s) => !isSessionEligible(s, state.filterMode)
  );
  const isExpanded = state.expandedOtherPools.has(pool.id);

  const eligibleActiveForChain = eligibleSessions.filter((s) => !s.isCancelled);

  const renderRow = (s, isEligibleRow) => {
    const catMeta = CATEGORY_META[s.category] || CATEGORY_META.leisure;
    const isCurrent =
      isEligibleRow &&
      !s.isCancelled &&
      s.startMinutes <= moment.targetMinutes &&
      moment.targetMinutes < s.endMinutes;

    const isPast =
      !isCurrent &&
      (state.timeMode === 'custom'
        ? s.endMinutes <= moment.targetMinutes
        : !moment.isFutureDate &&
          (moment.targetDate < moment.now.date ||
            s.endMinutes <= moment.targetMinutes));

    const isNext =
      !isCurrent &&
      isEligibleRow &&
      nextSession?.date === moment.targetDate &&
      nextSession?.session === s;

    let extraChainHint = '';
    if (isEligibleRow && !s.isCancelled) {
      const chain = findContiguousEnd(eligibleActiveForChain, s);
      if (chain.isContiguousChain) {
        extraChainHint = ` · 可连游至 ${chain.contiguousEnd24}`;
      }
    }

    return `
      <div class="session-row ${isCurrent ? 'is-current' : ''} ${isNext ? 'is-next' : ''} ${isPast ? 'is-past' : ''} ${!isEligibleRow ? 'is-ineligible' : ''} ${s.isCancelled ? 'is-cancelled' : ''}">
        <div class="session-time-col">
          <span class="session-time">${escapeHtml(s.timeLabel)}</span>
          <span class="session-duration">时长 ${formatDuration(s.durationMinutes)}${escapeHtml(extraChainHint)}</span>
        </div>
        <div class="session-info-col">
          <span class="session-prog-name">${escapeHtml(s.programTitle)}</span>
          <span class="cat-tag ${catMeta.tagClass}">${s.isCancelled ? '已取消 Cancelled' : escapeHtml(catMeta.label)}</span>
        </div>
      </div>
    `;
  };

  const dayRelLabel = formatRelativeDayLabel(moment.targetDate, moment.now.date);

  const eligibleListHtml =
    eligibleSessions.length > 0
      ? eligibleSessions.map((s) => renderRow(s, true)).join('')
      : `<div class="empty-sessions">${escapeHtml(dayRelLabel)} 无符合当前筛选的泳道场次</div>`;

  const otherToggleHtml =
    otherSessions.length > 0
      ? `
        <button
          type="button"
          class="hidden-sessions-toggle"
          data-toggle-other="${pool.id}"
        >
          ${isExpanded ? `收起其余 ${otherSessions.length} 场非目标项目` : `展开当日其余 ${otherSessions.length} 场专场/休闲项目`}
        </button>
        ${isExpanded ? otherSessions.map((s) => renderRow(s, false)).join('') : ''}
      `
      : '';

  const specsHtml = [pool.poolLength, ...(pool.highlights || [])]
    .map((sp) => `<span class="spec-chip">${escapeHtml(sp)}</span>`)
    .join('');

  return `
    <article class="pool-card ${cardStateClass}" id="pool-card-${pool.id}">
      <div class="pool-card-top">
        <div class="pool-status-row">
          <span class="status-badge ${badgeClass}">
            <span class="dot"></span>
            ${escapeHtml(badgeText)}
          </span>
          <span class="admission-tag ${pool.isFreeCentre ? 'is-free' : ''}">
            ${pool.isFreeCentre ? '免费 Free Centre' : '付费 Drop-in'}
          </span>
        </div>

        <h3 class="pool-name">${escapeHtml(pool.title)}</h3>

        <div class="pool-address-row">
          <span>${escapeHtml(pool.address)}</span>
          <span class="pool-links">
            <a href="${escapeHtml(pool.mapsUrl)}" target="_blank" rel="noopener noreferrer">地图导航</a>
            <a href="${escapeHtml(pool.facilityUrl)}" target="_blank" rel="noopener noreferrer">官网排期 ↗</a>
          </span>
        </div>

        <div class="pool-specs">${specsHtml}</div>
      </div>

      ${calloutHtml}
      ${alertsHtml}

      <div class="sessions-section">
        <div class="sessions-header">
          <span>${escapeHtml(dayRelLabel)} 场次明细</span>
          <span class="tabular">${eligibleSessions.length} 场可游</span>
        </div>
        ${eligibleListHtml}
        ${otherToggleHtml}
      </div>
    </article>
  `;
}

/* ==========================================================================
   Weekly 7-Day Comparison Matrix
   ========================================================================== */
function renderWeeklyTable(moment) {
  const container = document.getElementById('weekly-table-container');
  const filterNote = document.getElementById('weekly-filter-note');
  if (!container || !state.payload?.pools) return;

  document.querySelectorAll('#weekly-pool-tabs .pool-tab-btn').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.pool === state.weeklyPoolFilter);
  });

  if (filterNote) {
    filterNote.textContent = `当前筛选：${FILTER_MODES[state.filterMode].label}`;
  }

  const weeks = getAvailableWeeks();
  const activeWk = weeks[state.selectedWeekIdx];
  if (!activeWk) {
    container.innerHTML = `<div class="empty-sessions">暂无该周排期数据</div>`;
    return;
  }

  const dayColumns = WEEKDAY_HEADERS.map((d) => {
    const dateStr = addDays(activeWk.startDate, d.offset);
    return {
      ...d,
      date: dateStr,
      isSelected: dateStr === moment.targetDate,
      isToday: dateStr === moment.now.date,
    };
  });

  const poolsToShow =
    state.weeklyPoolFilter === 'all'
      ? state.payload.pools
      : state.payload.pools.filter((p) => String(p.id) === state.weeklyPoolFilter);

  const theadHtml = `
    <thead>
      <tr>
        <th>场馆</th>
        ${dayColumns
          .map(
            (col) => `
              <th class="${col.isSelected ? 'is-selected-day' : ''}">
                ${col.zh} ${col.isToday ? '(今天)' : ''}<br />
                <span class="tabular" style="font-weight:500;opacity:0.8">${formatShortDate(col.date)}</span>
              </th>
            `
          )
          .join('')}
      </tr>
    </thead>
  `;

  const tbodyRows = poolsToShow
    .map((pool) => {
      const poolWeek =
        pool.weeks.find((w) => w.startDate === activeWk.startDate) ||
        pool.weeks[state.selectedWeekIdx];
      const wkSessions = poolWeek?.sessions || [];

      const cellsHtml = dayColumns
        .map((col) => {
          const slots = wkSessions.filter(
            (s) => s.date === col.date && isSessionEligible(s, state.filterMode)
          );
          if (slots.length === 0) {
            return `<td class="${col.isSelected ? 'is-selected-day' : ''}" style="color:var(--ink-muted)">—</td>`;
          }
          return `
            <td class="${col.isSelected ? 'is-selected-day' : ''}">
              ${slots
                .map((s) => {
                  const isMen = s.category === 'lane_men';
                  const isRestricted =
                    s.category === 'lane_women' || s.category === 'lane_senior';
                  const subTag =
                    s.category === 'lane_general'
                      ? ''
                      : `<span class="wk-slot-label">${escapeHtml(CATEGORY_META[s.category]?.label || s.programTitle)}</span>`;
                  return `
                    <div class="wk-slot ${isMen ? 'slot-men' : ''} ${isRestricted ? 'slot-restricted' : ''}">
                      <span class="wk-slot-time">${escapeHtml(s.start24)} – ${escapeHtml(s.end24)}</span>
                      ${subTag}
                    </div>
                  `;
                })
                .join('')}
            </td>
          `;
        })
        .join('');

      return `
        <tr>
          <th>
            ${escapeHtml(pool.shortName)}
            <div style="font-size:0.71rem;font-weight:500;color:var(--ink-muted);margin-top:2px">
              ${pool.isFreeCentre ? '免费场馆' : '付费入场'}
            </div>
          </th>
          ${cellsHtml}
        </tr>
      `;
    })
    .join('');

  container.innerHTML = `
    <table class="weekly-table">
      ${theadHtml}
      <tbody>
        ${tbodyRows}
      </tbody>
    </table>
  `;
}

function renderSyncTimestamp() {
  const syncEl = document.getElementById('sync-status-text');
  if (!syncEl || !state.payload?.fetchedAt) return;
  const fetchedToronto = getTorontoNow(new Date(state.payload.fetchedAt));
  syncEl.textContent = `官网实时数据已同步 (${fetchedToronto.time24} ${fetchedToronto.tzAbbr})`;
}

/* ==========================================================================
   Event Listeners & Interactive Scrubbing
   ========================================================================== */
function bindEvents() {
  // Manual refresh
  document.getElementById('btn-refresh-data')?.addEventListener('click', () => {
    loadPoolsData({ forceRefresh: true });
  });
  document.getElementById('btn-retry-fetch')?.addEventListener('click', () => {
    loadPoolsData({ forceRefresh: true });
  });

  // Week dropdown
  document.getElementById('select-week')?.addEventListener('change', (e) => {
    const idx = Number(e.target.value);
    const weeks = getAvailableWeeks();
    if (weeks[idx]) {
      state.selectedWeekIdx = idx;
      const now = getTorontoNow();
      if (now.date >= weeks[idx].startDate && now.date <= weeks[idx].endDate) {
        state.selectedDate = now.date;
      } else {
        state.selectedDate = weeks[idx].startDate;
      }
      renderAll();
    }
  });

  // Day selector strip
  document.getElementById('day-selector-strip')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-date]');
    if (!btn) return;
    state.selectedDate = btn.dataset.date;
    state.selectedTimelineSession = null;
    renderAll();
  });

  // Live now button
  document.getElementById('btn-time-live')?.addEventListener('click', () => {
    const now = getTorontoNow();
    state.timeMode = 'live';
    state.selectedDate = now.date;
    alignInitialDateAndWeek(state.payload);
    renderAll();
  });

  // Quick time preset buttons
  document.querySelectorAll('.time-preset-btn[data-minutes]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.timeMode = 'custom';
      state.customMinutes = Number(btn.dataset.minutes);
      renderAll();
    });
  });

  // Custom time input
  document.getElementById('input-custom-time')?.addEventListener('input', (e) => {
    const val = e.target.value;
    if (!val || !val.includes(':')) return;
    const [h, m] = val.split(':').map(Number);
    if (!Number.isNaN(h) && !Number.isNaN(m)) {
      state.timeMode = 'custom';
      state.customMinutes = h * 60 + m;
      renderAll();
    }
  });

  // Filter mode pills
  document.getElementById('filter-pills-group')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-filter]');
    if (!btn) return;
    const mode = btn.dataset.filter;
    if (FILTER_MODES[mode]) {
      state.filterMode = mode;
      saveFilter(mode);
      renderAll();
    }
  });

  // Verdict chips -> smooth scroll to pool card
  document.getElementById('verdict-chips')?.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-scroll-pool]');
    if (!chip) return;
    const card = document.getElementById(`pool-card-${chip.dataset.scrollPool}`);
    card?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  // Timeline click: either inspect session block OR scrub query time
  document.getElementById('timeline-container')?.addEventListener('click', (e) => {
    const block = e.target.closest('.lane-block');
    if (block) {
      const poolObj = state.payload?.pools?.find(
        (p) => String(p.id) === block.dataset.poolId
      );
      state.selectedTimelineSession = {
        poolName: poolObj?.title || block.dataset.poolId,
        prog: block.dataset.prog,
        time: block.dataset.time,
        cat: block.dataset.cat,
      };
      renderAll();
      return;
    }

    const track = e.target.closest('[data-timeline-scrub]');
    if (track) {
      const rect = track.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const rawMinutes = TIMELINE_START_MIN + ratio * TIMELINE_SPAN_MIN;
      // Snap to nearest 15 minutes
      const snapped = Math.round(rawMinutes / 15) * 15;
      state.timeMode = 'custom';
      state.customMinutes = Math.max(TIMELINE_START_MIN, Math.min(TIMELINE_END_MIN, snapped));
      renderAll();
    }
  });

  // Expand / collapse non-eligible sessions inside pool card
  document.getElementById('pool-cards-grid')?.addEventListener('click', (e) => {
    const toggleBtn = e.target.closest('[data-toggle-other]');
    if (!toggleBtn) return;
    const pid = Number(toggleBtn.dataset.toggleOther);
    if (state.expandedOtherPools.has(pid)) {
      state.expandedOtherPools.delete(pid);
    } else {
      state.expandedOtherPools.add(pid);
    }
    renderAll();
  });

  // Weekly pool filter tabs
  document.getElementById('weekly-pool-tabs')?.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-pool]');
    if (!tab) return;
    state.weeklyPoolFilter = tab.dataset.pool;
    renderAll();
  });

  // Live clock tick every 30 seconds
  setInterval(() => {
    if (state.payload && state.timeMode === 'live') {
      renderAll();
    }
  }, 30000);
}

// Initialize app
bindEvents();
loadPoolsData({ forceRefresh: false });
