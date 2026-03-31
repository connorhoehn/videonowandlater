import SwiftUI
import UIKit
import Combine

/// Observes device orientation changes and publishes whether the device is in landscape.
/// Usage: `@StateObject private var orientationObserver = OrientationObserver()`
final class OrientationObserver: ObservableObject {
    @Published var isLandscape = false

    private var cancellable: AnyCancellable?

    init() {
        // Set initial value
        let orientation = UIDevice.current.orientation
        isLandscape = orientation == .landscapeLeft || orientation == .landscapeRight

        // Begin generating orientation notifications
        UIDevice.current.beginGeneratingDeviceOrientationNotifications()

        cancellable = NotificationCenter.default
            .publisher(for: UIDevice.orientationDidChangeNotification)
            .compactMap { _ -> Bool? in
                let o = UIDevice.current.orientation
                // Ignore .faceUp, .faceDown, .portraitUpsideDown, .unknown
                switch o {
                case .landscapeLeft, .landscapeRight:
                    return true
                case .portrait:
                    return false
                default:
                    return nil
                }
            }
            .receive(on: DispatchQueue.main)
            .assign(to: \.isLandscape, on: self)
    }

    deinit {
        cancellable?.cancel()
    }
}
