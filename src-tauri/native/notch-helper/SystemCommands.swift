import AppKit

func getNotchInfo() {
    guard let screen = NSScreen.main else {
        let fallback = NotchInfo(hasPhysicalNotch: false, screenWidth: 1512, screenHeight: 982, safeAreaTop: 0, notchX: 663, notchWidth: 185)
        printJson(fallback)
        return
    }

    var hasNotch = false
    var safeTop = 0.0
    var notchX = Double(screen.frame.width - 185.0) / 2.0
    var notchWidth = 185.0

    if #available(macOS 12.0, *) {
        safeTop = Double(screen.safeAreaInsets.top)
        hasNotch = safeTop > 0
        if let left = screen.auxiliaryTopLeftArea, let right = screen.auxiliaryTopRightArea {
            notchX = Double(left.maxX)
            notchWidth = Double(right.minX - left.maxX)
        }
    }

    let info = NotchInfo(
        hasPhysicalNotch: hasNotch,
        screenWidth: Double(screen.frame.width),
        screenHeight: Double(screen.frame.height),
        safeAreaTop: safeTop,
        notchX: notchX,
        notchWidth: notchWidth
    )
    printJson(info)
}

func getStatusBarApps() {
    let windowListInfo = CGWindowListCopyWindowInfo(.optionAll, kCGNullWindowID) as? [[String: Any]] ?? []

    // Only inspect genuine status bar items (layer 25, y == 0, height <= 45)
    let statusWindows = windowListInfo.filter {
        let layer = ($0[kCGWindowLayer as String] as? Int ?? 0)
        let bounds = $0[kCGWindowBounds as String] as? [String: Any] ?? [:]
        let y = bounds["Y"] as? Double ?? -1
        let h = bounds["Height"] as? Double ?? 0
        return layer == 25 && y == 0 && h <= 45
    }

    let screen = NSScreen.main
    var notchLeft = 663.0
    var notchRight = 848.0
    if #available(macOS 12.0, *), let s = screen, let l = s.auxiliaryTopLeftArea, let r = s.auxiliaryTopRightArea {
        notchLeft = Double(l.maxX)
        notchRight = Double(r.minX)
    }

    let ignoredNames: Set<String> = [
        "Control Centre",
        "ControlCenter",
        "TextInputMenuAgent",
        "Window Server",
        "SystemUIServer",
        "Dock"
    ]

    var appMap: [Int32: StatusBarApp] = [:]

    for win in statusWindows {
        let pid = win[kCGWindowOwnerPID as String] as? Int32 ?? 0
        if pid <= 0 { continue }

        let ownerName = win[kCGWindowOwnerName as String] as? String ?? ""
        let runningApp = NSRunningApplication(processIdentifier: pid)
        let name = runningApp?.localizedName ?? ownerName
        let bundleId = runningApp?.bundleIdentifier ?? ""

        if name.isEmpty || ignoredNames.contains(name) || bundleId.hasPrefix("com.apple.controlcenter") {
            continue
        }

        let isOnscreen = win[kCGWindowIsOnscreen as String] as? Bool ?? false
        let bounds = win[kCGWindowBounds as String] as? [String: Any] ?? [:]
        let x = bounds["X"] as? Double ?? 0
        let y = bounds["Y"] as? Double ?? 0
        let width = bounds["Width"] as? Double ?? 0
        let height = bounds["Height"] as? Double ?? 0

        // A status item is hidden if it's not on screen or positioned behind/to the left of the notch
        let isHidden = !isOnscreen || (x + width >= notchLeft && x <= notchRight) || (x < notchLeft)

        // Don't overwrite a visible state with a hidden state if an app has multiple status windows
        if let existing = appMap[pid] {
            if !existing.isHidden && isHidden {
                continue
            }
        }

        let iconBase64 = iconDataUrl(runningApp?.icon)

        let appItem = StatusBarApp(
            name: name,
            bundleId: bundleId,
            pid: pid,
            isHidden: isHidden,
            isOnscreen: isOnscreen,
            isSystem: false,
            x: x,
            y: y,
            width: width,
            height: height,
            iconBase64: iconBase64
        )
        appMap[pid] = appItem
    }

    // Sort: Hidden apps first, then alphabetical by name
    let sortedApps = appMap.values.sorted { a, b in
        if a.isHidden != b.isHidden {
            return a.isHidden && !b.isHidden
        }
        return a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending
    }

    let hiddenCount = sortedApps.filter { $0.isHidden }.count
    let response = StatusBarAppsResponse(
        hiddenCount: hiddenCount,
        totalCount: sortedApps.count,
        apps: sortedApps
    )
    printJson(response)
}

func activateApp(pid: Int32) {
    if let app = NSRunningApplication(processIdentifier: pid) {
        var success = false
        if #available(macOS 14.0, *) {
            app.activate()
            success = true
        } else {
            success = app.activate(options: [.activateIgnoringOtherApps])
        }
        printJson(ActionResponse(success: success, message: nil))
    } else {
        printJson(ActionResponse(success: false, message: "Application not found"))
    }
}

func quitApp(pid: Int32, force: Bool) {
    if let app = NSRunningApplication(processIdentifier: pid) {
        let success = force ? app.forceTerminate() : app.terminate()
        printJson(ActionResponse(success: success, message: nil))
    } else {
        if force {
            kill(pid, SIGKILL)
        } else {
            kill(pid, SIGTERM)
        }
        printJson(ActionResponse(success: true, message: nil))
    }
}

func openAirDrop() {
    let url = URL(fileURLWithPath: "/System/Library/CoreServices/Finder.app/Contents/Applications/AirDrop.app")
    let success = NSWorkspace.shared.open(url)
    printJson(ActionResponse(success: success, message: nil))
}

func shareAirDrop(paths: [String]) {
    guard let service = NSSharingService(named: .sendViaAirDrop) else {
        printJson(ActionResponse(success: false, message: "AirDrop service not available"))
        return
    }

    let urls = paths.map { URL(fileURLWithPath: $0) }
    DispatchQueue.main.async {
        if service.canPerform(withItems: urls) {
            service.perform(withItems: urls)
        } else {
            let airdropUrl = URL(fileURLWithPath: "/System/Library/CoreServices/Finder.app/Contents/Applications/AirDrop.app")
            NSWorkspace.shared.open(airdropUrl)
        }
    }
    printJson(ActionResponse(success: true, message: nil))
}

