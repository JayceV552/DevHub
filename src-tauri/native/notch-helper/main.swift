import AppKit

// devhub-notch-helper: small CLI that DevHub shells out to for macOS APIs that
// are awkward to reach from Rust (NSScreen geometry, status-bar windows,
// MediaRemote). Every command prints JSON on stdout.

let args = CommandLine.arguments
guard args.count >= 2 else {
    print("Usage: devhub-notch-helper <command> [args]")
    exit(1)
}

let command = args[1]
switch command {
case "notch-info":
    getNotchInfo()
case "status-apps":
    getStatusBarApps()
case "activate-app":
    if args.count >= 3, let pid = Int32(args[2]) {
        activateApp(pid: pid)
    } else {
        printJson(ActionResponse(success: false, message: "Missing pid"))
    }
case "quit-app":
    if args.count >= 3, let pid = Int32(args[2]) {
        quitApp(pid: pid, force: args.count >= 4 && args[3] == "force")
    } else {
        printJson(ActionResponse(success: false, message: "Missing pid"))
    }
case "music-status":
    getMusicStatus()
case "music-stream":
    runMusicStream()
case "music-control":
    controlMusic(action: args.count >= 3 ? args[2] : "toggle")
case "calendar-events":
    let startMs = args.count >= 3 ? Double(args[2]) ?? nowMillis() : nowMillis()
    let days = args.count >= 4 ? Int(args[3]) ?? 7 : 7
    getCalendarEvents(startMs: startMs, days: days)
case "open-airdrop":
    openAirDrop()
case "share-airdrop":
    shareAirDrop(paths: Array(args.dropFirst(2)))
default:
    printJson(ActionResponse(success: false, message: "Unknown command: \(command)"))
}
