import AppKit

struct NotchInfo: Codable {
    let hasPhysicalNotch: Bool
    let screenWidth: Double
    let screenHeight: Double
    let safeAreaTop: Double
    let notchX: Double
    let notchWidth: Double
}

struct StatusBarApp: Codable {
    let name: String
    let bundleId: String
    let pid: Int32
    let isHidden: Bool
    let isOnscreen: Bool
    let isSystem: Bool
    let x: Double
    let y: Double
    let width: Double
    let height: Double
    let iconBase64: String
}

struct StatusBarAppsResponse: Codable {
    let hiddenCount: Int
    let totalCount: Int
    let apps: [StatusBarApp]
}

struct MusicStatus: Codable {
    var isRunning: Bool
    var player: String
    var bundleId: String
    var isPlaying: Bool
    var title: String
    var artist: String
    var album: String
    var duration: Double
    /// Playback position (seconds) at `sampledAt`.
    var position: Double
    /// Unix epoch milliseconds when `position` was sampled; lets the UI
    /// interpolate progress locally instead of polling every second.
    var sampledAt: Double
    /// JPEG data URL of the album artwork, when the player provides one.
    var artwork: String?
    /// PNG data URL of the player app's icon (badge on the artwork).
    var appIcon: String?

    static let empty = MusicStatus(
        isRunning: false, player: "", bundleId: "", isPlaying: false,
        title: "", artist: "", album: "", duration: 0, position: 0,
        sampledAt: nowMillis(), artwork: nil, appIcon: nil
    )
}

struct ActionResponse: Codable {
    let success: Bool
    let message: String?
}

// MARK: - Output helpers

func nowMillis() -> Double {
    Date().timeIntervalSince1970 * 1000
}

func jsonLine<T: Encodable>(_ value: T) -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = .sortedKeys
    if let data = try? encoder.encode(value), let str = String(data: data, encoding: .utf8) {
        return str
    }
    return "{}"
}

/// Writes one JSON line unbuffered, so a parent reading a pipe sees it immediately.
func printJson<T: Encodable>(_ value: T) {
    let line = jsonLine(value) + "\n"
    FileHandle.standardOutput.write(line.data(using: .utf8) ?? Data())
}

// MARK: - Image helpers

private func encodeImage(_ image: NSImage, side: CGFloat, type: NSBitmapImageRep.FileType) -> Data? {
    var rect = NSRect(x: 0, y: 0, width: side, height: side)
    guard let cgImage = image.cgImage(forProposedRect: &rect, context: nil, hints: nil) else {
        return nil
    }
    // Draw into a fixed-size bitmap so huge artwork never reaches the webview.
    guard let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: Int(side), pixelsHigh: Int(side),
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
    ) else { return nil }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    NSGraphicsContext.current?.imageInterpolation = .high
    NSGraphicsContext.current?.cgContext.draw(cgImage, in: CGRect(x: 0, y: 0, width: side, height: side))
    NSGraphicsContext.restoreGraphicsState()
    let props: [NSBitmapImageRep.PropertyKey: Any] = type == .jpeg ? [.compressionFactor: 0.82] : [:]
    return rep.representation(using: type, properties: props)
}

func iconDataUrl(_ image: NSImage?, side: CGFloat = 36) -> String {
    guard let image = image, let data = encodeImage(image, side: side, type: .png) else { return "" }
    return "data:image/png;base64," + data.base64EncodedString()
}

func artworkDataUrl(_ data: Data, side: CGFloat = 240) -> String? {
    guard let image = NSImage(data: data), let jpeg = encodeImage(image, side: side, type: .jpeg) else {
        return nil
    }
    return "data:image/jpeg;base64," + jpeg.base64EncodedString()
}
