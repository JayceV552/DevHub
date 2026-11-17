import AppKit

/// Thin wrapper over the private MediaRemote framework (the same source the
/// macOS Now Playing widget uses). Works for any player that publishes
/// now-playing info: Music, Spotify, Telegram, browsers, podcasts…
final class MediaRemote {
    typealias GetInfoFn = @convention(c) (DispatchQueue, @escaping ([String: Any]) -> Void) -> Void
    typealias GetIsPlayingFn = @convention(c) (DispatchQueue, @escaping (Bool) -> Void) -> Void
    typealias GetPidFn = @convention(c) (DispatchQueue, @escaping (Int32) -> Void) -> Void
    typealias SendCommandFn = @convention(c) (Int, AnyObject?) -> Void

    static let shared = MediaRemote()

    private var getInfo: GetInfoFn?
    private var getIsPlaying: GetIsPlayingFn?
    private var getPid: GetPidFn?
    private var send: SendCommandFn?

    private init() {
        let url = NSURL(fileURLWithPath: "/System/Library/PrivateFrameworks/MediaRemote.framework")
        guard let bundle = CFBundleCreate(kCFAllocatorDefault, url) else { return }
        func load<T>(_ name: String, _: T.Type) -> T? {
            guard let ptr = CFBundleGetFunctionPointerForName(bundle, name as CFString) else { return nil }
            return unsafeBitCast(ptr, to: T.self)
        }
        getInfo = load("MRMediaRemoteGetNowPlayingInfo", GetInfoFn.self)
        getIsPlaying = load("MRMediaRemoteGetNowPlayingApplicationIsPlaying", GetIsPlayingFn.self)
        getPid = load("MRMediaRemoteGetNowPlayingApplicationPID", GetPidFn.self)
        send = load("MRMediaRemoteSendCommand", SendCommandFn.self)
    }

    @discardableResult
    func sendCommand(_ cmd: Int) -> Bool {
        guard let send = send else { return false }
        send(cmd, nil)
        return true
    }

    struct Snapshot {
        var info: [String: Any] = [:]
        var isPlaying = false
        var pid: Int32 = 0
    }

    func snapshot() -> Snapshot? {
        guard let getInfo = getInfo else { return nil }
        let group = DispatchGroup()
        let lock = NSLock()
        var snap = Snapshot()
        let queue = DispatchQueue.global(qos: .userInitiated)

        group.enter()
        getInfo(queue) { dict in
            lock.lock(); snap.info = dict; lock.unlock()
            group.leave()
        }
        if let getIsPlaying = getIsPlaying {
            group.enter()
            getIsPlaying(queue) { playing in
                lock.lock(); snap.isPlaying = playing; lock.unlock()
                group.leave()
            }
        }
        if let getPid = getPid {
            group.enter()
            getPid(queue) { pid in
                lock.lock(); snap.pid = pid; lock.unlock()
                group.leave()
            }
        }
        _ = group.wait(timeout: .now() + 0.5)
        lock.lock(); defer { lock.unlock() }
        return snap
    }
}

/// Caches the expensive bits (artwork + app icon encoding) between samples
/// so a long-running stream only re-encodes them when the track changes.
final class NowPlayingReader {
    private var artworkKey = ""
    private var artworkUrl: String?
    private var iconPid: Int32 = -1
    private var iconUrl: String?
    private var iconBundle = ""
    private var iconName = ""

    func read(includeArtwork: Bool, allowScripting: Bool) -> MusicStatus {
        if let status = readMediaRemote(includeArtwork: includeArtwork) {
            return status
        }
        if allowScripting, let status = readViaAppleScript() {
            return status
        }
        return MusicStatus.empty
    }

    private func readMediaRemote(includeArtwork: Bool) -> MusicStatus? {
        guard let snap = MediaRemote.shared.snapshot() else { return nil }
        let info = snap.info
        let title = info["kMRMediaRemoteNowPlayingInfoTitle"] as? String ?? ""
        let rate = (info["kMRMediaRemoteNowPlayingInfoPlaybackRate"] as? NSNumber)?.doubleValue ?? 0
        let isPlaying = snap.isPlaying || rate > 0
        if title.isEmpty && !isPlaying { return nil }

        let artist = info["kMRMediaRemoteNowPlayingInfoArtist"] as? String ?? ""
        let album = info["kMRMediaRemoteNowPlayingInfoAlbum"] as? String ?? ""
        let duration = (info["kMRMediaRemoteNowPlayingInfoDuration"] as? NSNumber)?.doubleValue ?? 0
        var elapsed = (info["kMRMediaRemoteNowPlayingInfoElapsedTime"] as? NSNumber)?.doubleValue ?? 0
        // ElapsedTime is relative to Timestamp; project it to "now".
        if isPlaying, let stamp = info["kMRMediaRemoteNowPlayingInfoTimestamp"] as? Date {
            elapsed += Date().timeIntervalSince(stamp) * (rate > 0 ? rate : 1)
        }
        if duration > 0 { elapsed = min(max(elapsed, 0), duration) }

        refreshApp(pid: snap.pid)

        if includeArtwork {
            let data = info["kMRMediaRemoteNowPlayingInfoArtworkData"] as? Data
            let key = "\(title)|\(artist)|\(album)|\(data?.count ?? 0)"
            if key != artworkKey {
                artworkKey = key
                artworkUrl = data.flatMap { artworkDataUrl($0) }
            }
        }

        return MusicStatus(
            isRunning: true,
            player: iconName.isEmpty ? "Media" : iconName,
            bundleId: iconBundle,
            isPlaying: isPlaying,
            title: title,
            artist: artist,
            album: album,
            duration: duration,
            position: elapsed,
            sampledAt: nowMillis(),
            artwork: includeArtwork ? artworkUrl : nil,
            appIcon: iconUrl
        )
    }

    private func refreshApp(pid: Int32) {
        guard pid != iconPid else { return }
        iconPid = pid
        let app = pid > 0 ? NSRunningApplication(processIdentifier: pid) : nil
        iconName = app?.localizedName ?? ""
        iconBundle = app?.bundleIdentifier ?? ""
        iconUrl = app.map { iconDataUrl($0.icon, side: 64) }
    }

    /// Fallback for setups where MediaRemote returns nothing.
    private func readViaAppleScript() -> MusicStatus? {
        let players: [(String, String, String)] = [
            ("com.apple.Music", "Music", "duration of current track"),
            ("com.spotify.client", "Spotify", "(duration of current track) / 1000"),
        ]
        for (bundle, name, durationExpr) in players
        where !NSRunningApplication.runningApplications(withBundleIdentifier: bundle).isEmpty {
            let src = """
            tell application id "\(bundle)"
                set pState to (player state as string)
                if pState is "stopped" then return "stopped"
                return pState & "\\t" & (name of current track) & "\\t" & (artist of current track) & "\\t" & (album of current track) & "\\t" & ((\(durationExpr)) as string) & "\\t" & (player position as string)
            end tell
            """
            var error: NSDictionary?
            guard let out = NSAppleScript(source: src)?.executeAndReturnError(&error).stringValue else {
                continue
            }
            let parts = out.components(separatedBy: "\t")
            guard parts.count >= 6 else { continue }
            let app = NSRunningApplication.runningApplications(withBundleIdentifier: bundle).first
            return MusicStatus(
                isRunning: true, player: name, bundleId: bundle,
                isPlaying: parts[0] == "playing",
                title: parts[1], artist: parts[2], album: parts[3],
                duration: Double(parts[4].replacingOccurrences(of: ",", with: ".")) ?? 0,
                position: Double(parts[5].replacingOccurrences(of: ",", with: ".")) ?? 0,
                sampledAt: nowMillis(), artwork: nil,
                appIcon: app.map { iconDataUrl($0.icon, side: 64) }
            )
        }
        return nil
    }
}

// MARK: - Commands

func getMusicStatus() {
    printJson(NowPlayingReader().read(includeArtwork: true, allowScripting: true))
}

/// Long-running mode: samples once a second in-process and writes a JSON line
/// only when something visible changed (track, play state, artwork, or a seek).
/// Exits as soon as stdin closes, so it never outlives DevHub.
func runMusicStream() {
    Thread {
        while readLine() != nil {}
        exit(0)
    }.start()

    let reader = NowPlayingReader()
    var last: MusicStatus?
    var tick = 0

    while true {
        autoreleasepool {
            // AppleScript fallback is comparatively slow; only try it every 3s.
            let current = reader.read(includeArtwork: true, allowScripting: tick % 3 == 0)
            if hasVisibleChange(from: last, to: current) {
                printJson(current)
                last = current
            }
        }
        tick += 1
        Thread.sleep(forTimeInterval: 1.0)
    }
}

private func hasVisibleChange(from old: MusicStatus?, to new: MusicStatus) -> Bool {
    guard let old = old else { return true }
    if old.isRunning != new.isRunning || old.isPlaying != new.isPlaying
        || old.title != new.title || old.artist != new.artist || old.album != new.album
        || old.bundleId != new.bundleId || old.artwork != new.artwork
        || Int(old.duration) != Int(new.duration) {
        return true
    }
    // Detect seeks: compare against where the UI would have extrapolated to.
    let expected = old.position + (old.isPlaying ? (new.sampledAt - old.sampledAt) / 1000 : 0)
    return abs(expected - new.position) > 2.0
}

// MARK: - Playback control

private func postMediaKey(_ key: Int32) {
    for (flags, state) in [(0xa00, 0xa), (0xb00, 0xb)] {
        let event = NSEvent.otherEvent(
            with: .systemDefined, location: .zero,
            modifierFlags: NSEvent.ModifierFlags(rawValue: UInt(flags)),
            timestamp: 0, windowNumber: 0, context: nil, subtype: 8,
            data1: Int((key << 16) | Int32(state << 8)), data2: -1
        )
        event?.cgEvent?.post(tap: .cghidEventTap)
    }
}

func controlMusic(action: String) {
    let commands: [String: (key: Int32, mr: Int)] = [
        "toggle": (16, 2),
        "next": (17, 4),
        "previous": (18, 5),
    ]
    guard let cmd = commands[action] else {
        printJson(ActionResponse(success: false, message: "Unknown action: \(action)"))
        return
    }
    // Send exactly one command: firing both the media key and the MediaRemote
    // command makes some players toggle twice (i.e. nothing happens).
    if !MediaRemote.shared.sendCommand(cmd.mr) {
        postMediaKey(cmd.key)
    }
    printJson(ActionResponse(success: true, message: nil))
}
