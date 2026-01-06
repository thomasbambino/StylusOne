import UIKit
import Capacitor
import WebKit
import AVKit

class PiPBridgeViewController: CAPBridgeViewController {

    override func viewDidLoad() {
        super.viewDidLoad()

        // Configure audio session for background playback and PiP
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            print("Failed to set audio session category: \(error)")
        }
    }

    override func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let config = super.webViewConfiguration(for: instanceConfiguration)

        // Enable Picture-in-Picture
        config.allowsPictureInPictureMediaPlayback = true

        // Allow inline media playback (required for PiP)
        config.allowsInlineMediaPlayback = true

        // Allow media to play without user gesture (for background continuation)
        config.mediaTypesRequiringUserActionForPlayback = []

        return config
    }
}
