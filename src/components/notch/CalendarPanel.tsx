import { useEffect, useMemo, useState } from "react";

import { api } from "../../lib/api";
import type { NotchDictionary, NotchLanguage } from "../../lib/notchI18n";
import type { CalendarEvent, CalendarEventsResponse } from "../../lib/types";
import { addDays, lunarDate, sameDay, startOfDay } from "./notchUtils";

interface CalendarPanelProps {
  language: NotchLanguage;
  t: NotchDictionary;
  /** Re-sync "today" and events whenever the notch opens. */
  active: boolean;
}

const VISIBLE_DAYS = 5;
const MAX_ROWS = 2;

export function CalendarPanel({ language, t, active }: CalendarPanelProps) {
  const [today, setToday] = useState(() => startOfDay(new Date()));
  const [selected, setSelected] = useState(() => startOfDay(new Date()));
  const [calendar, setCalendar] = useState<CalendarEventsResponse | null>(null);

  const firstDay = useMemo(() => addDays(today, -Math.floor(VISIBLE_DAYS / 2)), [today]);
  const days = useMemo(
    () => Array.from({ length: VISIBLE_DAYS }, (_, i) => addDays(firstDay, i)),
    [firstDay],
  );

  useEffect(() => {
    if (!active) return;
    const now = startOfDay(new Date());
    setToday((prev) => (sameDay(prev, now) ? prev : now));
    setSelected(now);
  }, [active]);

  // Fetch the visible window each time the notch opens (cheap: one EventKit query).
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    api.getCalendarEvents(firstDay.getTime(), VISIBLE_DAYS)
      .then((res) => {
        if (!cancelled) setCalendar(res);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [active, firstDay]);

  const formats = useMemo(
    () => ({
      month: new Intl.DateTimeFormat(t.locale, { month: language === "zh" ? "long" : "short" }),
      weekday: new Intl.DateTimeFormat(t.locale, { weekday: "short" }),
      time: new Intl.DateTimeFormat(t.locale, { hour: "2-digit", minute: "2-digit", hour12: false }),
    }),
    [t.locale, language],
  );

  const eventsByDay = useMemo(() => {
    const events = calendar?.events ?? [];
    return days.map((day) => {
      const from = day.getTime();
      const to = addDays(day, 1).getTime();
      return events.filter((ev) => ev.start < to && ev.end > from);
    });
  }, [calendar, days]);

  const selectedIndex = days.findIndex((d) => sameDay(d, selected));
  const dayEvents = selectedIndex >= 0 ? eventsByDay[selectedIndex] : [];
  const lunar = language === "zh" ? lunarDate(selected) : null;

  const timeLabel = (ev: CalendarEvent) => {
    if (ev.allDay) return t.allDay;
    // Multi-day timed events show their start only on the first day.
    return ev.start >= selected.getTime() ? formats.time.format(ev.start) : t.allDay;
  };

  return (
    <div className="notch-calendar">
      <div className="notch-cal-head">
        <span className="notch-cal-month">{formats.month.format(selected)}</span>
        <span className="notch-cal-year">{selected.getFullYear()}</span>
        {lunar && <span className="notch-cal-lunar">{lunar}</span>}
      </div>

      <div className="notch-cal-days" role="listbox">
        {days.map((day, i) => {
          const isSel = sameDay(day, selected);
          const isNow = sameDay(day, today);
          return (
            <button
              key={day.toDateString()}
              type="button"
              role="option"
              aria-selected={isSel}
              className={`notch-cal-day ${isSel ? "is-selected" : ""} ${isNow ? "is-today" : ""}`}
              onClick={() => setSelected(day)}
            >
              <span className="notch-cal-wd">{formats.weekday.format(day)}</span>
              <span className="notch-cal-num">{day.getDate()}</span>
              <span className={`notch-cal-dot ${eventsByDay[i].length ? "has-events" : ""}`} />
            </button>
          );
        })}
      </div>

      <div className="notch-cal-events">
        {calendar && calendar.access !== "authorized" ? (
          <span className="notch-cal-empty">{t.calendarDenied}</span>
        ) : dayEvents.length === 0 ? (
          <span className="notch-cal-empty">{calendar ? t.noEvents : " "}</span>
        ) : (
          <>
            {dayEvents.slice(0, MAX_ROWS).map((ev) => (
              <div key={ev.id} className="notch-cal-event" title={ev.calendar}>
                <span className="notch-cal-bar" style={{ background: ev.color }} />
                <span className="notch-cal-event-title">{ev.title}</span>
                <span className="notch-cal-event-time">{timeLabel(ev)}</span>
              </div>
            ))}
            {dayEvents.length > MAX_ROWS && (
              <span className="notch-cal-more">{t.moreEvents(dayEvents.length - MAX_ROWS)}</span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
