import AppKit
import EventKit

struct CalendarEvent: Codable {
    let id: String
    let title: String
    /// Unix epoch milliseconds.
    let start: Double
    let end: Double
    let allDay: Bool
    /// Calendar colour as "#rrggbb".
    let color: String
    let calendar: String
}

struct CalendarEventsResponse: Codable {
    /// "authorized", "denied", "restricted" or "notDetermined".
    let access: String
    let events: [CalendarEvent]
}

private func hexColor(_ color: NSColor?) -> String {
    guard let rgb = color?.usingColorSpace(.sRGB) else { return "#8e8e93" }
    let c = { (v: CGFloat) in Int((max(0, min(1, v)) * 255).rounded()) }
    return String(format: "#%02x%02x%02x", c(rgb.redComponent), c(rgb.greenComponent), c(rgb.blueComponent))
}

private func accessLabel(_ status: EKAuthorizationStatus) -> String {
    switch status {
    case .denied: return "denied"
    case .restricted: return "restricted"
    case .notDetermined: return "notDetermined"
    default: return "authorized"
    }
}

/// Asks for calendar access (the prompt is attributed to DevHub, the
/// responsible app) and blocks until the user answers.
private func ensureAccess(_ store: EKEventStore) -> String {
    let status = EKEventStore.authorizationStatus(for: .event)
    if #available(macOS 14.0, *) {
        if status == .fullAccess { return "authorized" }
    } else if status == .authorized {
        return "authorized"
    }
    guard status == .notDetermined else { return accessLabel(status) }

    let sema = DispatchSemaphore(value: 0)
    var granted = false
    let done: (Bool, Error?) -> Void = { ok, _ in
        granted = ok
        sema.signal()
    }
    if #available(macOS 14.0, *) {
        store.requestFullAccessToEvents(completion: done)
    } else {
        store.requestAccess(to: .event, completion: done)
    }
    // Generous timeout: the user may be reading the permission dialog.
    _ = sema.wait(timeout: .now() + 120)
    return granted ? "authorized" : "denied"
}

/// `calendar-events <startEpochMs> <days>`: events overlapping the range.
func getCalendarEvents(startMs: Double, days: Int) {
    let store = EKEventStore()
    let access = ensureAccess(store)
    guard access == "authorized" else {
        printJson(CalendarEventsResponse(access: access, events: []))
        return
    }

    let start = Date(timeIntervalSince1970: startMs / 1000)
    let end = Calendar.current.date(byAdding: .day, value: max(1, min(days, 31)), to: start) ?? start
    let predicate = store.predicateForEvents(withStart: start, end: end, calendars: nil)
    let events = store.events(matching: predicate)
        .sorted { a, b in
            if a.isAllDay != b.isAllDay { return a.isAllDay }
            return a.startDate < b.startDate
        }
        .map { ev in
            CalendarEvent(
                id: ev.calendarItemIdentifier + "@" + String(ev.startDate.timeIntervalSince1970),
                title: ev.title ?? "",
                start: ev.startDate.timeIntervalSince1970 * 1000,
                end: ev.endDate.timeIntervalSince1970 * 1000,
                allDay: ev.isAllDay,
                color: hexColor(ev.calendar?.color),
                calendar: ev.calendar?.title ?? ""
            )
        }
    printJson(CalendarEventsResponse(access: access, events: events))
}
