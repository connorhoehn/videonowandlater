import SwiftUI

/// Dark theme color palette matching the web app's design.
/// All colors are fixed (not adaptive to light/dark) since the app uses a dark-only theme.
extension Color {
    /// Primary background — #1a1a1a
    static let appBackground = Color(red: 0x1a / 255.0, green: 0x1a / 255.0, blue: 0x1a / 255.0)

    /// List/card background — #222222
    static let appBackgroundList = Color(red: 0x22 / 255.0, green: 0x22 / 255.0, blue: 0x22 / 255.0)

    /// Button/elevated surface background — #333333
    static let appBackgroundButton = Color(red: 0x33 / 255.0, green: 0x33 / 255.0, blue: 0x33 / 255.0)

    /// Secondary text / muted labels — #8e8e93
    static let appTextGray1 = Color(red: 0x8e / 255.0, green: 0x8e / 255.0, blue: 0x93 / 255.0)

    /// Success / live indicator green — #30d158
    static let appGreen = Color(red: 0x30 / 255.0, green: 0xd1 / 255.0, blue: 0x58 / 255.0)

    /// Destructive / error red — #ff453a
    static let appRed = Color(red: 0xff / 255.0, green: 0x45 / 255.0, blue: 0x3a / 255.0)

    /// Indigo accent — #6366f1
    static let appIndigo = Color(red: 0x63 / 255.0, green: 0x66 / 255.0, blue: 0xf1 / 255.0)

    /// Violet accent — #7c3aed
    static let appViolet = Color(red: 0x7c / 255.0, green: 0x3a / 255.0, blue: 0xed / 255.0)

    /// Input field background — subtle tint
    static let appInputBackground = Color.white.opacity(0.06)

    /// Input field focused background
    static let appInputFocused = Color.white.opacity(0.1)
}
