// swift-tools-version: 5.10

import PackageDescription

let package = Package(
    name: "AmazonIVSChatMessaging",
    platforms: [
        .iOS("14.0"),
    ],
    products: [
        .library(
            name: "AmazonIVSChatMessaging",
            targets: ["AmazonIVSChatMessaging"]
        ),
    ],
    targets: [
        .binaryTarget(
            name: "AmazonIVSChatMessaging",
            url: "https://ivschat.live-video.net/1.0.1/AmazonIVSChatMessaging.xcframework.zip",
            checksum: "9c0a3512ffc164a5f88c2a55d5fc834674f2e1f3649c61caad792c95e35a66ff"
        ),
    ]
)
