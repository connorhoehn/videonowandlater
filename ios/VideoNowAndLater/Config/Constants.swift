// Config/Constants.swift
// Values are read from Info.plist, which can be populated via Config.xcconfig.
// See ios/Config.xcconfig for the template.
import Foundation

enum Constants {
    private static let infoPlist = Bundle.main.infoDictionary ?? [:]

    // API
    static let apiUrl: String = infoPlist["API_URL"] as? String
        ?? "https://YOUR_API_GATEWAY_ID.execute-api.us-east-1.amazonaws.com/prod"

    // AWS
    static let awsRegion: String = infoPlist["AWS_REGION"] as? String ?? "us-east-1"

    // Cognito
    static let userPoolId: String = infoPlist["USER_POOL_ID"] as? String ?? "us-east-1_XXXXXXXX"
    static let clientId: String = infoPlist["COGNITO_CLIENT_ID"] as? String ?? "XXXXXXXXXXXXXXXXXXXXXXXXXX"

    // Cognito Hosted UI (OAuth2 PKCE)
    static let cognitoDomain: String = infoPlist["COGNITO_DOMAIN"] as? String
        ?? "https://YOUR_COGNITO_DOMAIN.auth.us-east-1.amazoncognito.com"
    static let callbackScheme = "videonowandlater"
    static let callbackUrl = "\(callbackScheme)://callback"

    // App
    static let appVersion = infoPlist["CFBundleShortVersionString"] as? String ?? "1.0"
    static let buildNumber = infoPlist["CFBundleVersion"] as? String ?? "1"
}
