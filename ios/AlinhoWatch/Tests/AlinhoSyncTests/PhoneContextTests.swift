import Foundation
import Testing
@testable import AlinhoSync

// A sessão que o iPhone manda no applicationContext (WatchGamesPlugin.swift).

@Test func phoneContextParsesTheSession() {
    let json = #"{"access_token":"at","refresh_token":"rt","expires_at":1793000000,"user_id":"6F1C2A4E-0000-4000-8000-000000000009","supabase_url":"https://x.supabase.co","anon_key":"anon"}"#
    let c = WatchCredentials.fromPhoneContext(json)
    #expect(c?.accessToken == "at")
    #expect(c?.refreshToken == "rt")
    #expect(c?.expiresAt == Date(timeIntervalSince1970: 1_793_000_000))
    #expect(c?.userID == UUID(uuidString: "6f1c2a4e-0000-4000-8000-000000000009"))
    #expect(c?.supabaseURL.absoluteString == "https://x.supabase.co")
    #expect(c?.anonKey == "anon")
}

@Test func phoneContextRejectsIncompleteOrBadJSON() {
    #expect(WatchCredentials.fromPhoneContext("none") == nil)
    #expect(WatchCredentials.fromPhoneContext(#"{"access_token":"at"}"#) == nil)
    #expect(WatchCredentials.fromPhoneContext(#"{"access_token":"at","refresh_token":"rt","expires_at":1,"user_id":"nope","supabase_url":"https://x.supabase.co","anon_key":"a"}"#) == nil)
}
