# VideoNowAndLater iOS App

Native iOS client for the VideoNowAndLater live/recorded video streaming platform.

## Requirements

- Xcode 15+
- iOS 16+ deployment target
- Physical device for broadcast/hangout features (camera + microphone)

## Setup

1. Open `ios/VideoNowAndLater.xcodeproj` in Xcode (or open the `ios/` folder if using SPM directly).
2. Xcode will resolve Swift Package Manager dependencies automatically:
   - Amazon IVS Player SDK (>= 1.40.0)
   - Amazon IVS Broadcast SDK (>= 1.36.0)
   - Amazon IVS Chat Messaging SDK (>= 1.0.1)
3. Select your development team under **Signing & Capabilities**.
4. Update the bundle identifier to match your provisioning profile (e.g., `com.yourteam.VideoNowAndLater`).
5. Set the API base URL and Cognito config in `Config/AppConfig.swift`.
6. Build and run on a physical device (simulator does not support camera capture).

## Architecture

- **App/** — App entry point, environment setup, color assets
- **Config/** — API URLs, Cognito configuration
- **Models/** — Data models (Session, ChatMessage, etc.)
- **Networking/** — APIClient, auth token management
- **ViewModels/** — ObservableObject view models per feature
- **Views/** — SwiftUI views organized by feature (Broadcast, Hangout, Feed, Replay, Chat, Components)
