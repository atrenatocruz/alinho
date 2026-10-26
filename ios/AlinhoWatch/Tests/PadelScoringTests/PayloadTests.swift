import Foundation
import Testing
@testable import PadelScoring

// O que o relógio manda ao iPhone por cada jogo acabado (Fase B).

private func finished(_ format: MatchFormat, _ seq: String) -> MatchRecord {
    var ses = session(started: match(format, total: 24))
    for c in seq where c != " " {
        for _ in 0..<4 { ses.point(c == "u" ? .us : .them, at: t0.addingTimeInterval(600)) }
    }
    if !(ses.current?.isOver ?? true) { ses.stop(at: t0.addingTimeInterval(1800)) }
    return ses.history[0]
}

@Test func payloadRoundTrips() throws {
    var record = finished(.bestOf3, "uuuuuu uuuuuu")
    record.effort = 7
    let p = WatchGamePayload(record, updatedAt: t0)
    let back = try WatchGamePayload.decode(p.encoded())
    #expect(back == p)
    #expect(p.winner == "us" && p.sets == [[6, 0], [6, 0]] && p.effort == 7 && !p.deleted)
}

@Test func endlessSetPayloadCarriesGames() {
    let p = WatchGamePayload(finished(.endlessSet, String(repeating: "u", count: 13) + String(repeating: "t", count: 11)), updatedAt: t0)
    #expect(p.sets == [[13, 11]] && p.format == "ssf" && p.resultText == "13-11")
}

@Test func runningPointsPayloadCarriesPoints() {
    var ses = session(started: match(.points, total: 24))
    for c in String(repeating: "u", count: 15) + String(repeating: "t", count: 9) { ses.point(c == "u" ? .us : .them, at: t0) }
    let p = WatchGamePayload(ses.history[0], updatedAt: t0)
    #expect(p.sets == [[15, 9]] && p.format == "pts" && p.resultText == "15-9")
}

@Test func payloadHasVersion2() {
    #expect(WatchGamePayload(finished(.oneSet, "uu"), updatedAt: t0).version == 2)
}

@Test func deletedPayloadOnlyCarriesID() throws {
    let id = UUID()
    let p = WatchGamePayload.deleted(id: id, at: t0)
    #expect(p.id == id && p.deleted && p.resultText.isEmpty)
    #expect(try WatchGamePayload.decode(p.encoded()) == p)
}

@Test func userInfoHoldsJSON() throws {
    let p = WatchGamePayload(finished(.oneSet, "uu"), updatedAt: t0)
    let json = try #require(p.userInfo()["game"] as? String)
    #expect(try WatchGamePayload.decode(Data(json.utf8)) == p)
}
