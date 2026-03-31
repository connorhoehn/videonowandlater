// swift-tools-version: 5.10

import PackageDescription

let package = Package(
    name: "AmazonIVSBroadcast",
    platforms: [
        .iOS("14.0"),
    ],
    products: [
        .library(
            name: "AmazonIVSBroadcast",
            targets: ["AmazonIVSBroadcast"]
        ),
    ],
    targets: [
        .binaryTarget(
            name: "AmazonIVSBroadcast",
            url: "https://broadcast.live-video.net/1.40.0/AmazonIVSBroadcast-Stages.xcframework.zip",
            checksum: "0795f2f473330873682a3b3d68692b0c2e16dcdb0735e636514033ec63bb7398"
        ),
    ]
)
