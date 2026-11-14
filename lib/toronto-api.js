/**
 * Shared City of Toronto Parks & Recreation live schedule fetcher.
 * Runtime-agnostic (Web Standard fetch) — runs identically on:
 * - Vercel Serverless Functions (/api/pools.js)
 * - Cloudflare Pages Functions (/functions/api/pools.js)
 * - Local Node.js dev server (server.js)
 */

const TORONTO_BASE = 'https://www.toronto.ca/data/parks/live/locations';
const FACILITY_PAGE_BASE =
  'https://www.toronto.ca/explore-enjoy/parks-recreation/places-spaces/parks-and-recreation-facilities/location/?id=';

export const POOLS_CONFIG = [
  {
    id: 451,
    shortName: 'Wellesley',
    neighborhood: 'St. James Town / Sherbourne',
    poolLength: '25m 室内池 · 6 泳道',
    highlights: ['Sherbourne 站步行 5m', '含桑拿 & 温水池'],
    defaultAddress: '495 Sherbourne St',
  },
  {
    id: 2012,
    shortName: 'Pam McConnell',
    neighborhood: 'Regent Park / Dundas E',
    poolLength: '25m 室内池 · 6 泳道',
    highlights: ['505 Dundas 电车直达', '通用/家庭更衣室'],
    defaultAddress: '640 Dundas St E',
  },
  {
    id: 272,
    shortName: 'St. Lawrence',
    neighborhood: 'St. Lawrence Market / Esplanade',
    poolLength: '25m 室内池',
    highlights: ['近 St. Lawrence Market', 'King / Union 步行可达'],
    defaultAddress: '230 The Esplanade',
  },
];

const DAY_OFFSETS = {
  monday: 0,
  tuesday: 1,
  wednesday: 2,
  thursday: 3,
  friday: 4,
  saturday: 5,
  sunday: 6,
};

let memoryCache = {
  payload: null,
  timestampMs: 0,
};
const CACHE_TTL_MS = 90 * 1000; // 90s server-side soft cache

/**
 * Classify a Toronto swim program title into a structured swim category.
 */
export function classifySwimProgram(rawTitle = '', rawAge = '') {
  const title = rawTitle.trim();
  const lower = title.toLowerCase();
  const ageLower = (rawAge || '').toLowerCase();

  const isLane = lower.includes('lane swim') || lower.includes('length swim');
  if (isLane) {
    if (/\b(women|woman|female|girls)\b/i.test(lower)) {
      return 'lane_women';
    }
    if (/\b(men|man|male|boys)\b/i.test(lower)) {
      return 'lane_men';
    }
    if (
      /\b(older adult|senior|60\+|55\+)\b/i.test(lower) ||
      /\b60\s*years\s*and\s*over\b/i.test(ageLower)
    ) {
      return 'lane_senior';
    }
    if (/\b(youth|teen|child|preschool)\b/i.test(lower)) {
      return 'lane_youth';
    }
    return 'lane_general';
  }

  if (lower.includes('aquatic fitness') || lower.includes('aquafit')) {
    return 'aquafit';
  }

  if (lower.includes('lesson') || lower.includes('level up')) {
    return 'lessons';
  }

  return 'leisure';
}

/**
 * Parse "07:00 AM - 09:15 AM" into { startMinutes, endMinutes, start24, end24 }.
 */
export function parseTimeRange(timeStr = '') {
  const match = timeStr
    .trim()
    .match(/^(\d{1,2}):(\d{2})\s*(AM|PM)\s*-\s*(\d{1,2}):(\d{2})\s*(AM|PM)$/i);

  if (!match) {
    return null;
  }

  const toMinutes = (hStr, mStr, meridiem) => {
    let h = parseInt(hStr, 10);
    const m = parseInt(mStr, 10);
    const mer = meridiem.toUpperCase();
    if (mer === 'AM' && h === 12) h = 0;
    if (mer === 'PM' && h !== 12) h += 12;
    return h * 60 + m;
  };

  const fmt24 = (mins) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  const startMinutes = toMinutes(match[1], match[2], match[3]);
  const endMinutes = toMinutes(match[4], match[5], match[6]);

  return {
    startMinutes,
    endMinutes,
    durationMinutes: Math.max(0, endMinutes - startMinutes),
    start24: fmt24(startMinutes),
    end24: fmt24(endMinutes),
  };
}

/**
 * Add `days` to a YYYY-MM-DD date string in pure calendar arithmetic (timezone-safe).
 */
export function addCalendarDays(yyyyMmDd, daysToAdd) {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + daysToAdd));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

async function fetchJsonSafe(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'TorontoPoolScheduleTracker/1.0',
      },
    });
    if (!res.ok) {
      return null;
    }
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeAlerts(alertsJson, poolId) {
  const rawList = alertsJson?.locations?.[`id_${poolId}`];
  if (!Array.isArray(rawList) || rawList.length === 0) {
    return [];
  }
  return rawList.map((item) => {
    const reason = (item.Reason || '').trim();
    const isSeasonalClosure = /closed for the season/i.test(reason);
    let severity = 'info';
    if (item.Status === 0 || isSeasonalClosure) {
      severity = 'closure';
    } else if (item.Status === 2) {
      severity = 'warning';
    }
    return {
      assetId: item.AssetID ?? null,
      category: item.Category || item.DisplayAlertName || 'Facility',
      assetName: item.AssetName || '',
      reason,
      comments: (item.Comments || '').trim(),
      postedDate: item.PostedDate || '',
      status: item.Status,
      severity,
      isPoolRelated: /pool|swim|aquatic|spa|sauna|hot tub|change room/i.test(
        `${item.Category} ${item.AssetName} ${item.Comments} ${item.DisplayAlertName}`
      ),
    };
  });
}

function normalizeOperatingHours(hoursArr) {
  const h = Array.isArray(hoursArr) && hoursArr[0] ? hoursArr[0] : null;
  if (!h) return null;
  return {
    monday: h.ohmo && h.ohmc ? `${h.ohmo} - ${h.ohmc}` : null,
    tuesday: h.ohtuo && h.ohtuc ? `${h.ohtuo} - ${h.ohtuc}` : null,
    wednesday: h.ohwo && h.ohwc ? `${h.ohwo} - ${h.ohwc}` : null,
    thursday: h.ohtho && h.ohthc ? `${h.ohtho} - ${h.ohthc}` : null,
    friday: h.ohfo && h.ohfc ? `${h.ohfo} - ${h.ohfc}` : null,
    saturday: h.ohsao && h.ohsac ? `${h.ohsao} - ${h.ohsac}` : null,
    sunday: h.ohsuo && h.ohsuc ? `${h.ohsuo} - ${h.ohsuc}` : null,
  };
}

async function fetchSinglePool(poolCfg) {
  const cacheBust = `?_=${Math.floor(Date.now() / 30000)}`;
  const baseUrl = `${TORONTO_BASE}/${poolCfg.id}`;

  const [infoJson, alertsJson, noticeJson, swimInfoJson] = await Promise.all([
    fetchJsonSafe(`${baseUrl}/info.json`),
    fetchJsonSafe(`${baseUrl}/alerts.json${cacheBust}`),
    fetchJsonSafe(`${baseUrl}/notice.json${cacheBust}`),
    fetchJsonSafe(`${baseUrl}/swim/info.json`),
  ]);

  const rawWeeks = Array.isArray(swimInfoJson?.weeks) ? swimInfoJson.weeks : [];
  const weekPayloads = await Promise.all(
    rawWeeks.map(async (wk) => {
      const hasProgs = wk.hasPrograms === true || wk.hasPrograms === 'true';
      if (!hasProgs || !wk.json) {
        return { meta: wk, data: null };
      }
      const data = await fetchJsonSafe(`${baseUrl}/swim/${wk.json}`);
      return { meta: wk, data };
    })
  );

  const weeks = weekPayloads
    .filter((w) => w.meta?.title)
    .map(({ meta, data }) => {
      const weekStart = meta.title.trim(); // Monday YYYY-MM-DD
      const weekEnd = addCalendarDays(weekStart, 6);
      const sessions = [];

      const programs = Array.isArray(data?.programs) ? data.programs : [];
      for (const progGroup of programs) {
        const days = Array.isArray(progGroup.days) ? progGroup.days : [];
        for (const progEntry of days) {
          const programTitle = (progEntry.title || '').trim();
          const age = (progEntry.age || '').trim();
          const category = classifySwimProgram(programTitle, age);
          const entryStatus = (progEntry.status || 'active').toLowerCase();
          const times = Array.isArray(progEntry.times) ? progEntry.times : [];

          for (const slot of times) {
            const dayKey = (slot.day || '').toLowerCase().trim();
            if (!(dayKey in DAY_OFFSETS)) continue;
            const parsed = parseTimeRange(slot.title || '');
            if (!parsed) continue;

            const date = addCalendarDays(weekStart, DAY_OFFSETS[dayKey]);
            const slotStatus =
              slot.status && slot.status.toLowerCase() !== 'active'
                ? slot.status.toLowerCase()
                : entryStatus;

            sessions.push({
              date,
              dayOfWeek: dayKey,
              programTitle,
              category,
              age,
              timeLabel: (slot.title || '').trim(),
              start24: parsed.start24,
              end24: parsed.end24,
              startMinutes: parsed.startMinutes,
              endMinutes: parsed.endMinutes,
              durationMinutes: parsed.durationMinutes,
              status: slotStatus,
              isCancelled: slotStatus === 'cancelled',
              comment: (slot.comment || progEntry.comment || '').trim(),
            });
          }
        }
      }

      sessions.sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        if (a.startMinutes !== b.startMinutes) return a.startMinutes - b.startMinutes;
        return a.endMinutes - b.endMinutes;
      });

      return {
        weekIndex: meta.id,
        startDate: weekStart,
        endDate: weekEnd,
        sessions,
      };
    });

  const features = Array.isArray(infoJson?.feat)
    ? infoJson.feat.map((f) => f.featn).filter(Boolean)
    : [];
  const isFreeCentre = features.some((f) => /free centre/i.test(f));
  const address = (infoJson?.address || poolCfg.defaultAddress).trim();

  return {
    id: poolCfg.id,
    shortName: poolCfg.shortName,
    title: infoJson?.title || poolCfg.shortName,
    neighborhood: poolCfg.neighborhood,
    poolLength: poolCfg.poolLength,
    highlights: poolCfg.highlights,
    address,
    phone: infoJson?.phone || '',
    lat: infoJson?.lat ? Number(infoJson.lat) : null,
    lng: infoJson?.lng ? Number(infoJson.lng) : null,
    isFreeCentre,
    features,
    facilityUrl: `${FACILITY_PAGE_BASE}${poolCfg.id}`,
    mapsUrl: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
      `${address}, Toronto, ON`
    )}`,
    sourceUpdatedAt: infoJson?.ts || null,
    operatingHours: normalizeOperatingHours(infoJson?.hours),
    notice: noticeJson?.info || null,
    alerts: normalizeAlerts(alertsJson, poolCfg.id),
    weeks,
  };
}

export async function getPoolsPayload({ forceRefresh = false } = {}) {
  const now = Date.now();
  if (
    !forceRefresh &&
    memoryCache.payload &&
    now - memoryCache.timestampMs < CACHE_TTL_MS
  ) {
    return {
      ...memoryCache.payload,
      cached: true,
    };
  }

  const pools = await Promise.all(POOLS_CONFIG.map((cfg) => fetchSinglePool(cfg)));

  const payload = {
    fetchedAt: new Date().toISOString(),
    timezone: 'America/Toronto',
    cached: false,
    pools,
  };

  memoryCache = {
    payload,
    timestampMs: now,
  };

  return payload;
}
