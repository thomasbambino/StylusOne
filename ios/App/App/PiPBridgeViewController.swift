import UIKit
import Capacitor
import WebKit
import AVKit

class PiPBridgeViewController: CAPBridgeViewController {

    override func viewDidLoad() {
        super.viewDidLoad()

        // Set black background to prevent white flash
        view.backgroundColor = .black

        // Set webView background to black (prevents white flash before content loads)
        webView?.isOpaque = false
        webView?.backgroundColor = .black
        webView?.scrollView.backgroundColor = .black

        // Configure audio session for background playback and PiP
        // Use .default mode to prevent AirPlay popup on launch
        // (.moviePlayback mode triggers iOS to scan for AirPlay devices)
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            print("Failed to set audio session category: \(error)")
        }
    }

    // Register local plugins
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(NativeTabBarPlugin())
    }

    override func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let config = super.webViewConfiguration(for: instanceConfiguration)

        // Enable Picture-in-Picture
        config.allowsPictureInPictureMediaPlayback = true

        // Enable AirPlay for video playback
        config.allowsAirPlayForMediaPlayback = true

        // Allow inline media playback (required for PiP)
        config.allowsInlineMediaPlayback = true

        // Allow media to play without user gesture (for background continuation)
        config.mediaTypesRequiringUserActionForPlayback = []

        return config
    }
}
