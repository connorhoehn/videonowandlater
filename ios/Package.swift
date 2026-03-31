// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "VideoNowAndLater",
    platforms: [
        .iOS(.v16)
    ],
    products: [
        .library(
            name: "VideoNowAndLater",
            targets: ["VideoNowAndLater"]
        )
    ],
    dependencies: [],
    targets: [
        .target(
            name: "VideoNowAndLater",
            dependencies: [
                "AmazonIVSPlayer",
                "AmazonIVSBroadcast",
                "AmazonIVSChatMessaging",
            ],
            path: "VideoNowAndLater"
        ),
        .binaryTarget(
            name: "AmazonIVSPlayer",
            url: "https://player.live-video.net/1.50.0/AmazonIVSPlayer.xcframework.zip",
            checksum: "fac2eb41f61b090a2744402b60c934cfef8411b46033370f4a2a017ba598d268"
        ),
        .binaryTarget(
            name: "AmazonIVSBroadcast",
            url: "https://broadcast.live-video.net/1.40.0/AmazonIVSBroadcast-Stages.xcframework.zip",
            checksum: "0795f2f473330873682a3b3d68692b0c2e16dcdb0735e636514033ec63bb7398"
        ),
        .binaryTarget(
            name: "AmazonIVSChatMessaging",
            url: "https://ivschat.live-video.net/1.0.1/AmazonIVSChatMessaging.xcframework.zip",
            checksum: "9c0a3512ffc164a5f88c2a55d5fc834674f2e1f3649c61caad792c95e35a66ff"
        ),
    ]
)
