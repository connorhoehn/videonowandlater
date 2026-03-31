// Views/Components/FloatingHeartsView.swift
// Ported from amazon-ivs-feed-ios-demo HeartView pattern, adapted for SwiftUI.
// TikTok-style floating hearts that bloom, drift upward along bezier curves, then fade out.

import SwiftUI

struct FloatingHeart: Identifiable {
    let id = UUID()
    let color: Color
    let startX: CGFloat
    let controlPoint1: CGPoint
    let controlPoint2: CGPoint
    let endPoint: CGPoint
    let rotation: Double
    let createdAt = Date()
    var emoji: String? = nil  // nil = default heart icon
}

struct FloatingHeartsView: View {
    @Binding var hearts: [FloatingHeart]

    var body: some View {
        GeometryReader { geo in
            ZStack {
                ForEach(hearts) { heart in
                    FloatingHeartAnimationView(heart: heart, containerHeight: geo.size.height) {
                        hearts.removeAll { $0.id == heart.id }
                    }
                }
            }
        }
        .allowsHitTesting(false)
    }
}

private struct FloatingHeartAnimationView: View {
    let heart: FloatingHeart
    let containerHeight: CGFloat
    let onComplete: () -> Void

    @State private var phase: CGFloat = 0   // 0 → 1 over animation duration
    @State private var opacity: Double = 1
    @State private var scale: CGFloat = 0

    private let duration: Double = 3.0

    var body: some View {
        Group {
            if let emoji = heart.emoji {
                Text(emoji)
                    .font(.system(size: 32))
            } else {
                Image(systemName: "heart.fill")
                    .font(.system(size: 28))
                    .foregroundColor(heart.color)
            }
        }
            .scaleEffect(scale)
            .opacity(opacity)
            .rotationEffect(.radians(heart.rotation))
            .position(x: currentPosition.x, y: containerHeight + currentPosition.y)
            .onAppear {
                // Bloom in (from feed demo: spring damping 0.6)
                withAnimation(.spring(response: 0.4, dampingFraction: 0.6)) {
                    scale = 1.0
                }
                // Float upward
                withAnimation(.linear(duration: duration)) {
                    phase = 1.0
                }
                // Fade out in last 40%
                withAnimation(.easeIn(duration: duration * 0.4).delay(duration * 0.6)) {
                    opacity = 0
                    scale = 0.5
                }
                // Cleanup
                DispatchQueue.main.asyncAfter(deadline: .now() + duration + 0.1) {
                    onComplete()
                }
            }
    }

    /// Cubic bezier interpolation (matching feed demo's CAKeyframeAnimation on UIBezierPath)
    private var currentPosition: CGPoint {
        let t = phase
        let t2 = t * t
        let t3 = t2 * t
        let mt = 1 - t
        let mt2 = mt * mt
        let mt3 = mt2 * mt

        let start = CGPoint(x: heart.startX, y: 0)  // relative to bottom
        let x = mt3 * start.x + 3 * mt2 * t * heart.controlPoint1.x +
                3 * mt * t2 * heart.controlPoint2.x + t3 * heart.endPoint.x
        let y = mt3 * start.y + 3 * mt2 * t * heart.controlPoint1.y +
                3 * mt * t2 * heart.controlPoint2.y + t3 * heart.endPoint.y
        return CGPoint(x: x, y: y)
    }
}

// MARK: - Heart Factory (matching feed demo's random color palette + bezier generation)

enum HeartFactory {
    private static let colors: [Color] = [
        Color(red: 1.0, green: 0, blue: 0.72),     // #FF00B8
        Color(red: 1.0, green: 0.33, blue: 0.33),   // #FF5555
        Color(red: 0.73, green: 0.53, blue: 1.0),    // #BB86FF
        Color(red: 1.0, green: 0.89, blue: 0.29),    // #FFE249
        Color(red: 0.29, green: 1.0, blue: 0.87),    // #49FFDE
    ]

    static func create(in size: CGSize, emoji: String? = nil) -> FloatingHeart {
        let heartSize: CGFloat = 35
        let startX = size.width * 0.85  // Bottom-right area (like button position)
        let endX = startX + CGFloat.random(in: -80...40)
        let endY = -size.height * 0.6

        let xDelta = (heartSize / 2 + CGFloat.random(in: 0...(2 * heartSize))) * (Bool.random() ? 1 : -1)
        let yDelta = CGFloat.random(in: 0...(3 * heartSize))

        return FloatingHeart(
            color: colors.randomElement()!,
            startX: startX,
            controlPoint1: CGPoint(x: startX + xDelta, y: -yDelta),
            controlPoint2: CGPoint(x: startX - 2 * xDelta, y: endY * 0.5),
            endPoint: CGPoint(x: endX, y: endY),
            rotation: Double.random(in: -.pi/16 ... .pi/16),
            emoji: emoji
        )
    }
}
